// Client-side OCR for quest-journal screenshots.
//
// Tesseract runs in a WASM worker in the user's browser — no API key, no quota,
// no server. Raw accuracy is mediocre on Tarkov's light-on-dark condensed UI
// font, which is why preprocess() below does the heavy lifting and why the
// matcher in questMatch.js is fuzzy rather than exact.

// Upscale small text toward the ~30px cap height Tesseract likes, without
// building a canvas big enough to blow up a phone.
const TARGET_WIDTH = 3000
const MAX_SCALE    = 3
const MAX_PIXELS   = 14e6

let workerPromise = null
let onProgress    = null   // swapped per-scan; the worker's logger is fixed at creation

// One worker for the page lifetime. First call downloads the wasm core and the
// English model (~5MB, browser-cached thereafter); later scans reuse it.
function getWorker() {
  if (!workerPromise) {
    workerPromise = import('tesseract.js')
      .then(({ createWorker }) => createWorker('eng', 1, {
        logger: m => { if (onProgress) onProgress(m) },
      }))
      .then(async worker => {
        await worker.setParameters({
          tessedit_pageseg_mode:     '6',   // one uniform block — keeps journal rows as lines
          preserve_interword_spaces: '1',
          user_defined_dpi:          '300', // silences resolution guessing
        })
        return worker
      })
      .catch(err => { workerPromise = null; throw err })
  }
  return workerPromise
}

export function warmUpOcr() {
  getWorker().catch(() => {})   // fire-and-forget; the real scan surfaces errors
}

export async function disposeOcr() {
  if (!workerPromise) return
  const pending = workerPromise
  workerPromise = null
  try { (await pending).terminate() } catch { /* already gone */ }
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload  = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')) }
    img.src = url
  })
}

// Grayscale → invert dark UI to black-on-white → stretch contrast.
// Tesseract binarizes internally, so the goal is a clean gray ramp, not a
// hard threshold of our own.
function preprocess(img) {
  let scale = Math.min(TARGET_WIDTH / img.naturalWidth, MAX_SCALE)
  if (scale < 1) scale = 1
  const pixels = img.naturalWidth * img.naturalHeight * scale * scale
  if (pixels > MAX_PIXELS) scale *= Math.sqrt(MAX_PIXELS / pixels)

  const w = Math.max(1, Math.round(img.naturalWidth  * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, w, h)

  const image = ctx.getImageData(0, 0, w, h)
  const px    = image.data
  const gray  = new Uint8ClampedArray(w * h)
  const hist  = new Uint32Array(256)

  let sum = 0
  for (let i = 0, p = 0; p < px.length; i++, p += 4) {
    const g = (px[p] * 0.299 + px[p + 1] * 0.587 + px[p + 2] * 0.114) | 0
    gray[i] = g
    hist[g]++
    sum += g
  }

  // Tarkov's journal is light text on a dark panel; Tesseract wants the reverse.
  const invert = sum / gray.length < 128

  // Percentile clip rather than min/max — a single blown-out pixel shouldn't
  // define the range.
  const total = gray.length
  const loCut = total * 0.02
  const hiCut = total * 0.98
  let lo = 0, hi = 255, acc = 0
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= loCut) { lo = v; break } }
  acc = 0
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= hiCut) { hi = v; break } }

  const span    = hi - lo
  const stretch = span >= 8   // below this the image is flat and stretching is noise

  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    let g = gray[i]
    if (stretch) {
      g = ((g - lo) * 255) / span
      g = g < 0 ? 0 : g > 255 ? 255 : g
    }
    if (invert) g = 255 - g
    px[p] = px[p + 1] = px[p + 2] = g
    px[p + 3] = 255
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

// Downscaled copy of the original for the UI thumbnail — the preprocessed
// canvas is unpleasant to look at and much larger.
function previewUrl(img) {
  const MAX = 480
  let w = img.naturalWidth, h = img.naturalHeight
  if (w > MAX || h > MAX) {
    if (w >= h) { h = Math.round(h * MAX / w); w = MAX }
    else        { w = Math.round(w * MAX / h); h = MAX }
  }
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  c.getContext('2d').drawImage(img, 0, 0, w, h)
  return c.toDataURL('image/jpeg', 0.7)
}

/**
 * OCR a screenshot file.
 * @param {File|Blob} file
 * @param {(stage: string, progress: number) => void} [report] 0..1 within a stage
 * @returns {Promise<{ lines: string[], text: string, preview: string }>}
 */
export async function scanImage(file, report) {
  const img     = await loadImage(file)
  const preview = previewUrl(img)
  const canvas  = preprocess(img)

  report?.('preparing', 1)

  // Registered before getWorker() so the one-time core + model download reports
  // progress too — on a cold cache that is most of the wait.
  onProgress = m => {
    if (m.status === 'recognizing text') report?.('reading', m.progress)
    else if (typeof m.status === 'string' && m.status.startsWith('loading')) report?.('loading', m.progress)
  }
  try {
    const worker = await getWorker()
    const { data } = await worker.recognize(canvas)
    const text  = data?.text ?? ''
    const lines = text
      .split('\n')
      .map(l => l.replace(/\s+/g, ' ').trim())
      .filter(l => l.length >= 3)
    return { lines, text, preview }
  } finally {
    onProgress = null
  }
}
