import { useState, useEffect, useRef, useCallback } from 'react'
import { scanImage, warmUpOcr } from '../questOcr'
import { matchQuestLines } from '../questMatch'

const STAGE_LABEL = {
  loading:   'DOWNLOADING TEXT ENGINE (ONE TIME)...',
  preparing: 'PREPARING IMAGE...',
  reading:   'READING SCREENSHOT...',
}

export default function QuestScanner({ allTasks, userQuests, onAdd, onAdded, defaultOpen = false }) {
  const [open,       setOpen]       = useState(defaultOpen)
  const [scanning,   setScanning]   = useState(false)
  const [stage,      setStage]      = useState('preparing')
  const [progress,   setProgress]   = useState(0)
  const [error,      setError]      = useState(null)
  const [results,    setResults]    = useState(null)  // accumulated matched task objects
  const [selected,   setSelected]   = useState(new Set())
  const [preview,    setPreview]    = useState(null)
  const [rawText,    setRawText]    = useState('')    // shown when a scan finds nothing
  const [showRaw,    setShowRaw]    = useState(false)
  const [showUpload, setShowUpload] = useState(true)
  const [saving,     setSaving]     = useState(false)
  const fileRef = useRef()
  const busyRef = useRef(false)   // the paste listener stays live during a scan

  // Start fetching the wasm core + language model while the user hunts for
  // their screenshot, so the first scan isn't waiting on a 5MB download.
  useEffect(() => { if (open) warmUpOcr() }, [open])

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
    if (busyRef.current) return
    if (!file?.type.startsWith('image/')) {
      setError('Please provide an image file.')
      return
    }
    busyRef.current = true
    setError(null)
    setPreview(null)
    setRawText('')
    setShowRaw(false)
    setShowUpload(false)
    setStage('preparing')
    setProgress(0)
    setScanning(true)
    try {
      const { lines, text, preview: thumb } = await scanImage(file, (s, p) => {
        setStage(s)
        setProgress(p || 0)
      })
      setPreview(thumb)
      setRawText(text)

      const { matches, lowConfidence } = matchQuestLines(lines, allTasks)
      const isNew = t => !userQuests.find(q => q.quest_id === t.id)

      const confident = matches.filter(isNew)
      const maybe     = lowConfidence.filter(isNew).map(t => ({ ...t, uncertain: true }))

      // Merge into existing results, deduplicating by task ID
      setResults(prev => {
        const base = prev ?? []
        const seen = new Set(base.map(t => t.id))
        return [...base, ...[...confident, ...maybe].filter(t => {
          if (seen.has(t.id)) return false
          seen.add(t.id)
          return true
        })]
      })
      // Auto-select confident hits only; uncertain ones are opt-in.
      setSelected(prev => new Set([...prev, ...confident.map(t => t.id)]))
    } catch (err) {
      setError(err?.message || 'Could not read that screenshot')
      setShowUpload(true)
    } finally {
      busyRef.current = false
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

  async function handleAddSelected() {
    const chosen = results.filter(task => selected.has(task.id))
    if (!chosen.length) return
    setSaving(true)
    setError(null)
    try {
      await Promise.all(chosen.map(task => onAdd({ id: task.id, name: task.name }, task.detectedMap ?? null)))
      // Only after every write settles, so a partial failure reports no import.
      onAdded?.(chosen)
      reset()
    } catch {
      setError('The selected quests could not all be saved. Review your list and retry the remaining quests.')
    } finally {
      setSaving(false)
    }
  }

  function reset() {
    setResults(null)
    setSelected(new Set())
    setPreview(null)
    setError(null)
    setScanning(false)
    setRawText('')
    setShowRaw(false)
    setShowUpload(true)
  }

  function scanAnother() {
    setPreview(null)
    setError(null)
    setRawText('')
    setShowRaw(false)
    setShowUpload(true)
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
  const uncertainCount = (results ?? []).filter(t => t.uncertain).length

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
          aria-label="Close screenshot scanner"
          style={{ background: 'none', border: 'none', color: 'var(--txd)', fontSize: 18, cursor: 'pointer', padding: 0 }}
        >×</button>
      </div>

      {/* Drop / paste zone */}
      {!scanning && showUpload && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Choose a quest journal screenshot"
          onClick={() => fileRef.current?.click()}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              fileRef.current?.click()
            }
          }}
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
          <div className="mono" style={{ fontSize: 10, color: 'var(--txd)', marginTop: 6 }}>
            READ ON YOUR OWN DEVICE — NOTHING IS UPLOADED
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
        <div role="status" aria-live="polite" style={{ padding: '28px 0', textAlign: 'center' }}>
          <div className="mono" style={{ fontSize: 11, color: 'var(--gold)', letterSpacing: '.08em' }}>
            {STAGE_LABEL[stage] ?? 'SCANNING...'}
          </div>
          <div style={{
            marginTop: 12, height: 3, borderRadius: 2, background: 'var(--sur2)',
            overflow: 'hidden', maxWidth: 260, marginLeft: 'auto', marginRight: 'auto',
          }}>
            <div style={{
              width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`, height: '100%',
              background: 'var(--gold)', transition: 'width .2s linear',
            }} />
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
            <div style={{ textAlign: 'center', padding: '12px 0' }}>
              <div className="mono" style={{ fontSize: 11, color: 'var(--txm)' }}>
                NO UNTRACKED QUESTS DETECTED
              </div>
              <div className="mono" style={{ fontSize: 10, color: 'var(--txd)', marginTop: 6 }}>
                TRY A LARGER, UNSCALED SCREENSHOT OF THE QUEST LIST
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 }}>
                <button className="btn-ghost btn-sm" onClick={scanAnother} style={{ fontSize: 12 }}>
                  TRY ANOTHER
                </button>
                {rawText.trim() && (
                  <button className="btn-ghost btn-sm" onClick={() => setShowRaw(v => !v)} style={{ fontSize: 12 }}>
                    {showRaw ? 'HIDE' : 'SHOW'} WHAT WE READ
                  </button>
                )}
              </div>
              {showRaw && (
                <pre className="mono" style={{
                  textAlign: 'left', marginTop: 10, padding: '8px 10px', borderRadius: 4,
                  background: 'var(--sur2)', border: '1px solid var(--brd)', maxHeight: 160,
                  overflow: 'auto', fontSize: 10, color: 'var(--txd)', whiteSpace: 'pre-wrap',
                }}>{rawText.trim()}</pre>
              )}
            </div>
          ) : (
            <>
              <div className="mono" style={{ fontSize: 10, color: 'var(--txm)', marginBottom: 8 }}>
                {results.length} QUEST{results.length !== 1 ? 'S' : ''} DETECTED — SELECT WHICH TO ADD
                {uncertainCount > 0 && ` · ${uncertainCount} UNCERTAIN`}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
                {results.map(t => (
                  <label key={t.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                    background: 'var(--sur2)',
                    border: `1px solid ${selected.has(t.id) ? 'var(--golddim)' : 'var(--brd)'}`,
                    borderLeft: `3px solid ${selected.has(t.id) ? 'var(--gold)' : 'var(--brd)'}`,
                    borderRadius: 4, cursor: 'pointer', boxSizing: 'border-box', width: '100%',
                    opacity: t.uncertain && !selected.has(t.id) ? .65 : 1,
                  }}>
                    <input
                      type="checkbox"
                      checked={selected.has(t.id)}
                      onChange={() => toggleSelect(t.id)}
                      style={{ accentColor: 'var(--gold)', cursor: 'pointer', flexShrink: 0, width: 14, height: 14 }}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: 13, color: '#e8e0cc' }}>
                        {t.name}
                        {t.uncertain && (
                          <span className="mono" style={{ marginLeft: 8, fontSize: 9, color: '#c08a4a' }}>UNCERTAIN</span>
                        )}
                      </span>
                      <span className="mono" style={{ fontSize: 10, color: '#7a8070' }}>
                        {t.trader?.name}{t.trader?.name && ' · '}Lv.{t.minPlayerLevel || 1}
                        {' · '}{t.detectedMap ? t.detectedMap.replace(/-/g, ' ').toUpperCase() : 'ANY MAP'}
                        {t.kappaRequired && <span style={{ marginLeft: 8, color: 'var(--gold)' }}>κ</span>}
                      </span>
                    </div>
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn-gold btn-sm"
                  onClick={handleAddSelected}
                  disabled={selectedCount === 0 || saving}
                  style={{ fontSize: 12, opacity: selectedCount === 0 ? .4 : 1 }}
                >
                  {saving ? 'SAVING...' : `ADD ${selectedCount > 0 ? selectedCount : ''} QUEST${selectedCount !== 1 ? 'S' : ''}`}
                </button>
                <button className="btn-ghost btn-sm" onClick={scanAnother} disabled={saving} style={{ fontSize: 12 }}>
                  SCAN ANOTHER
                </button>
              </div>
            </>
          )}
        </>
      )}

      {/* Error */}
      {error && (
        <div className="mono" role="alert" style={{
          marginTop: 10, padding: '8px 10px', borderRadius: 4,
          background: 'rgba(180,60,60,.12)', border: '1px solid rgba(180,60,60,.3)',
          fontSize: 11, color: '#e07070',
        }}>
          {error}
        </div>
      )}
    </div>
  )
}
