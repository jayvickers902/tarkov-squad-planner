import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../supabase'

// Compress + encode image to base64 JPEG (max 1920px wide, quality 0.85)
// Keeps costs down and stays well under Claude's 5MB image limit
async function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const MAX = 1920
      let w = img.naturalWidth, h = img.naturalHeight
      if (w > MAX || h > MAX) {
        if (w >= h) { h = Math.round(h * MAX / w); w = MAX }
        else        { w = Math.round(w * MAX / h); h = MAX }
      }
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      canvas.toBlob(blob => {
        if (!blob) { reject(new Error('Image compression failed')); return }
        const reader = new FileReader()
        reader.onload = e => resolve({
          base64:    e.target.result.split(',')[1],
          mediaType: 'image/jpeg',
          previewUrl: URL.createObjectURL(blob),
        })
        reader.onerror = reject
        reader.readAsDataURL(blob)
      }, 'image/jpeg', 0.85)
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Invalid image')) }
    img.src = url
  })
}

function normalize(str) {
  return str.toLowerCase().trim().replace(/['']/g, "'").replace(/\s+/g, ' ')
}

// Match Claude's returned names against the full task list
function matchTasks(detectedNames, allTasks) {
  const results = []
  const seen = new Set()
  for (const name of detectedNames) {
    if (!name || typeof name !== 'string') continue
    const nd = normalize(name)
    let match =
      allTasks.find(t => normalize(t.name) === nd) ||
      allTasks.find(t => normalize(t.name).includes(nd) && nd.length > 4) ||
      allTasks.find(t => nd.includes(normalize(t.name)) && normalize(t.name).length > 4)
    if (match && !seen.has(match.id)) {
      seen.add(match.id)
      results.push(match)
    }
  }
  return results
}

export default function QuestScanner({ allTasks, userQuests, onAdd }) {
  const [open,      setOpen]      = useState(false)
  const [scanning,  setScanning]  = useState(false)
  const [error,     setError]     = useState(null)
  const [results,   setResults]   = useState(null)   // matched task objects
  const [selected,  setSelected]  = useState(new Set())
  const [preview,   setPreview]   = useState(null)
  const [remaining, setRemaining] = useState(null)   // scans left this hour
  const fileRef = useRef()
  const zoneRef = useRef()

  // Global paste listener while the scanner is open
  useEffect(() => {
    if (!open) return
    function onPaste(e) {
      const items = Array.from(e.clipboardData?.items || [])
      const imgItem = items.find(i => i.type.startsWith('image/'))
      if (imgItem) {
        e.preventDefault()
        processFile(imgItem.getAsFile())
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [open]) // eslint-disable-line

  const processFile = useCallback(async (file) => {
    if (!file?.type.startsWith('image/')) {
      setError('Please provide an image file.')
      return
    }
    setError(null)
    setResults(null)
    setSelected(new Set())
    setPreview(null)
    setScanning(true)
    try {
      const { base64, mediaType, previewUrl } = await compressImage(file)
      setPreview(previewUrl)
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not logged in')

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
      const res = await fetch(`${supabaseUrl}/functions/v1/scan-quests`, {
        method:  'POST',
        headers: {
          Authorization:  `Bearer ${session.access_token}`,
          apikey:         anonKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ image: base64, mediaType }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`)

      if (typeof data.remaining === 'number') setRemaining(data.remaining)

      const matched = matchTasks(data.quests || [], allTasks)
      const fresh   = matched.filter(t => !userQuests.find(q => q.quest_id === t.id))
      setResults(fresh)
      setSelected(new Set(fresh.map(t => t.id)))
    } catch (err) {
      setError(err.message)
    } finally {
      setScanning(false)
    }
  }, [allTasks, userQuests])

  function handleDrop(e) {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file) processFile(file)
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function handleAddSelected() {
    for (const task of results) {
      if (selected.has(task.id)) {
        onAdd({ id: task.id, name: task.name }, null)
      }
    }
    reset()
  }

  function reset() {
    setResults(null)
    setSelected(new Set())
    setPreview(null)
    setError(null)
    setScanning(false)
  }

  function close() {
    reset()
    setOpen(false)
  }

  if (!open) {
    return (
      <button
        className="btn-ghost btn-sm"
        onClick={() => setOpen(true)}
        style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 5 }}
      >
        <span style={{ fontSize: 14 }}>⊕</span> SCAN FROM SCREENSHOT
      </button>
    )
  }

  const selectedCount = selected.size

  return (
    <div className="card" style={{ padding: 16, marginBottom: 16, border: '1px solid var(--golddim)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div className="lbl" style={{ color: 'var(--gold)' }}>SCAN FROM SCREENSHOT</div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--txm)', marginTop: 2 }}>
            PASTE (CTRL+V) OR UPLOAD A SCREENSHOT OF YOUR TARKOV QUEST JOURNAL
          </div>
        </div>
        <button
          onClick={close}
          style={{ background: 'none', border: 'none', color: 'var(--txd)', fontSize: 18, cursor: 'pointer', padding: 0 }}
        >×</button>
      </div>

      {/* Drop / paste zone */}
      {!scanning && !results && (
        <div
          ref={zoneRef}
          onClick={() => fileRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
          style={{
            border: '2px dashed var(--brd2)', borderRadius: 6, padding: '28px 16px',
            textAlign: 'center', cursor: 'pointer', transition: 'border-color .15s',
            background: 'var(--sur2)',
          }}
          onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--golddim)'}
          onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--brd2)'}
        >
          <div style={{ fontSize: 28, marginBottom: 8, opacity: .5 }}>📷</div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--txm)' }}>
            PASTE IMAGE (CTRL+V) · DRAG & DROP · OR CLICK TO UPLOAD
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={e => { if (e.target.files?.[0]) processFile(e.target.files[0]); e.target.value = '' }}
          />
        </div>
      )}

      {/* Scanning state */}
      {scanning && (
        <div style={{ padding: '28px 0', textAlign: 'center' }}>
          {preview && (
            <img src={preview} alt="" style={{
              maxWidth: '100%', maxHeight: 140, borderRadius: 4, marginBottom: 14,
              objectFit: 'contain', opacity: .7,
            }} />
          )}
          <div className="mono" style={{ fontSize: 11, color: 'var(--gold)', letterSpacing: '.08em' }}>
            SCANNING FOR QUESTS...
          </div>
        </div>
      )}

      {/* Results */}
      {!scanning && results !== null && (
        <>
          {preview && (
            <img src={preview} alt="" style={{
              maxWidth: '100%', maxHeight: 120, borderRadius: 4, marginBottom: 12,
              objectFit: 'contain', opacity: .6,
            }} />
          )}

          {results.length === 0 ? (
            <div className="mono" style={{ fontSize: 11, color: 'var(--txm)', textAlign: 'center', padding: '12px 0' }}>
              NO UNTRACKED QUESTS DETECTED — TRY A CLEARER SCREENSHOT
            </div>
          ) : (
            <>
              <div className="mono" style={{ fontSize: 10, color: 'var(--txm)', marginBottom: 8 }}>
                {results.length} QUEST{results.length !== 1 ? 'S' : ''} DETECTED — SELECT WHICH TO ADD:
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
                {results.map(t => (
                  <label key={t.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                    background: 'var(--sur2)',
                    border: `1px solid ${selected.has(t.id) ? 'var(--golddim)' : 'var(--brd)'}`,
                    borderLeft: `3px solid ${selected.has(t.id) ? 'var(--gold)' : 'var(--brd)'}`,
                    borderRadius: 4, cursor: 'pointer',
                  }}>
                    <input
                      type="checkbox"
                      checked={selected.has(t.id)}
                      onChange={() => toggleSelect(t.id)}
                      style={{ accentColor: 'var(--gold)', cursor: 'pointer', flexShrink: 0 }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: 'var(--tx)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.name}
                      </div>
                      <div className="mono" style={{ fontSize: 10, color: 'var(--txm)', marginTop: 1 }}>
                        {t.trader?.name} · Lv.{t.minPlayerLevel || 1}
                        {t.kappaRequired && <span style={{ marginLeft: 8, color: 'var(--gold)' }}>κ</span>}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn-gold btn-sm"
                  onClick={handleAddSelected}
                  disabled={selectedCount === 0}
                  style={{ fontSize: 12, opacity: selectedCount === 0 ? .4 : 1 }}
                >
                  ADD {selectedCount > 0 ? selectedCount : ''} QUEST{selectedCount !== 1 ? 'S' : ''}
                </button>
                <button className="btn-ghost btn-sm" onClick={reset} style={{ fontSize: 12 }}>
                  SCAN ANOTHER
                </button>
              </div>
            </>
          )}
        </>
      )}

      {/* Error */}
      {error && (
        <div className="mono" style={{
          marginTop: 10, padding: '8px 10px', borderRadius: 4,
          background: 'rgba(180,60,60,.12)', border: '1px solid rgba(180,60,60,.3)',
          fontSize: 11, color: '#e07070',
        }}>
          {error}
        </div>
      )}

      {/* Rate limit hint */}
      {remaining !== null && !scanning && (
        <div className="mono" style={{ marginTop: 10, fontSize: 10, color: 'var(--txd)', textAlign: 'right' }}>
          {remaining} SCAN{remaining !== 1 ? 'S' : ''} REMAINING THIS HOUR
        </div>
      )}
    </div>
  )
}
