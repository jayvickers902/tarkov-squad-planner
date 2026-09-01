import { useState, useMemo, useEffect, useId, useRef, useCallback } from 'react'
import { useTasks } from '../useTarkov'
import { useEftLogSync, useEftScreenshotSyncContext } from '../EftLogSyncContext'
import { FEATURED } from '../constants'
import QuestImportHub from './QuestImportHub'
import { GAME_MODES, gameModeLabel, resolvePartyMode } from '../gameMode'
import { useCompanionSyncStatus } from '../useCompanionSyncStatus'
import { relativeTime, screenshotChannelStatus, STATE_TEXT } from '../syncStatus'
import { mapBannerLayers, mapHeaderBanner } from '../mapBanners'
import Icon from './Icon'
import { inferredTaskMapNorm } from '../tarkovObjectives'

export const IMPORT_RESTORE_STORAGE_KEY = 'tsp.quest_import_restore.v1'
export const IMPORT_RESTORE_TTL_MS = 24 * 60 * 60 * 1000
export const COLLAPSED_MAPS_STORAGE_KEY = 'tsp.quest_collapsed_maps.v1'

const HISTORY_LIMIT = 1000
const HISTORY_PREVIEW_ROWS = 8
// The banner falls back to the splash art: with no quests there is no map to
// pick, and an empty background layer would paint nothing at all.
const BANNER_FALLBACK = "url('/splash-2560.webp')"

function validImportRestorePoint(value, userId, gameMode, now = Date.now()) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.quests)) return null
  if (value.version !== 1 || value.userId !== userId || value.gameMode !== gameMode) return null
  if (!Number.isFinite(value.expiresAt) || value.expiresAt <= now) return null
  return { ...value, quests: value.quests.filter(quest => quest && typeof quest === 'object' && !Array.isArray(quest)) }
}

function validSnapshot(value, gameMode) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (!Array.isArray(value.quests)) return null
  if (value.gameMode && value.gameMode !== gameMode) return null
  return {
    ...value,
    gameMode: value.gameMode || gameMode,
    quests: value.quests.filter(quest => quest && typeof quest === 'object' && !Array.isArray(quest)),
  }
}

// Small Kappa badge — reused in search results and saved list
function KappaBadge() {
  return <span className="mono quest-kappa" title="Required for Kappa">κ</span>
}

function QuestEmptyState({ onOpenHub, onManualSearch }) {
  return (
    <div className="card quest-empty-card quest-empty-card-page">
      <div className="quest-empty-state">
        <h3>NO QUESTS YET</h3>
        <p>Import your quest list to get started — it takes about a minute.</p>
        <div className="quest-empty-actions">
          <button className="btn-gold" onClick={onOpenHub}>GET YOUR QUESTS IN</button>
          <button className="btn-ghost btn-sm" onClick={onManualSearch}>ADD ONE MANUALLY</button>
        </div>
      </div>
    </div>
  )
}

const MAP_NAMES = {
  customs: 'Customs', woods: 'Woods', interchange: 'Interchange',
  shoreline: 'Shoreline', factory: 'Factory', lighthouse: 'Lighthouse',
  'streets-of-tarkov': 'Streets', reserve: 'Reserve',
  'ground-zero': 'Ground Zero', 'the-lab': 'The Lab',
}

const ANY_MAP_KEY = 'any'

function mapLabel(mapNorm) {
  if (!mapNorm) return 'ANY MAP'
  return (MAP_NAMES[mapNorm] || mapNorm).toUpperCase()
}

function readCollapsedMaps() {
  try {
    const stored = JSON.parse(localStorage.getItem(COLLAPSED_MAPS_STORAGE_KEY) || '[]')
    return new Set(Array.isArray(stored) ? stored.filter(value => typeof value === 'string') : [])
  } catch {
    return new Set()
  }
}

function historyDate(value) {
  if (!value) return ''
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return ''
  return at.toLocaleDateString(undefined, { day: '2-digit', month: 'short' }).toUpperCase()
}

export default function MyQuests({ userId, userQuests, onAdd, onRemove, onToggleImportant, onToggleSkipped, onClearAll, onRestore, onDone, inParty, userSettings = {}, onSetUserSetting, onMarkCompleted, onReconcileLogEvents, onGetQuestHistory, gameMode: passedGameMode = null }) {
  const [mapFilter, setMapFilter]     = useState('all')
  const [searchMap, setSearchMap]     = useState('any')
  const [searchQ, setSearchQ]         = useState('')
  const [searchOpen, setSearchOpen]   = useState(false)
  const [searchMapsOpen, setSearchMapsOpen] = useState(false)
  const [listQuery, setListQuery]     = useState('')
  const [kappaOnly, setKappaOnly]     = useState(false)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [collapsedMaps, setCollapsedMaps] = useState(readCollapsedMaps)
  const [confirmClear, setConfirmClear] = useState(false)
  const [recentlyAdded, setRecentlyAdded] = useState(new Set())
  const [questOrder, setQuestOrder] = useState(() => userQuests.map(q => q.quest_id))
  const [hubOpen, setHubOpen] = useState(false)
  const [importReceipt, setImportReceipt] = useState(null)
  const [importRestorePoint, setImportRestorePoint] = useState(null)
  const [undoingImport, setUndoingImport] = useState(false)
  const [undoError, setUndoError] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyRows, setHistoryRows] = useState(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyExpanded, setHistoryExpanded] = useState(false)
  const [dragId, setDragId] = useState(null)
  const [dropId, setDropId] = useState(null)
  // HTML5 drag never fires for touch, so the same handle also runs a pointer
  // gesture. The in-flight state is a ref: a move must not re-render per frame,
  // and the commit must not read a stale dropId out of a closure.
  const pointerDragRef = useRef(null)
  const kappaOnlyId = useId()
  const searchInputRef = useRef(null)
  const savedQuestsRef = useRef(null)
  const handleRefs = useRef(new Map())
  const refocusHandleRef = useRef(null)

  // Sync questOrder when userQuests changes externally (restore, clear, done)
  useEffect(() => {
    setQuestOrder(prev => {
      const currentIds = new Set(userQuests.map(q => q.quest_id))
      const cleaned = prev.filter(id => currentIds.has(id))
      const existingSet = new Set(cleaned)
      const newIds = userQuests.filter(q => !existingSet.has(q.quest_id)).map(q => q.quest_id)
      return [...newIds, ...cleaned]
    })
    // A row that left the list must not keep a checkbox tick alive in the bulk bar.
    setSelectedIds(prev => {
      if (prev.size === 0) return prev
      const currentIds = new Set(userQuests.map(q => q.quest_id))
      const next = new Set([...prev].filter(id => currentIds.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [userQuests])

  const gameMode = passedGameMode || resolvePartyMode(null, userSettings)
  const canChangeGameMode = !inParty && !!onSetUserSetting
  const eftLogSync = useEftLogSync({ optional: true })
  const screenshotSync = useEftScreenshotSyncContext({ optional: true })
  const companion = useCompanionSyncStatus({ optional: true })

  useEffect(() => {
    // An undo point belongs to one character mode and must never be replayed
    // into another mode after the user switches tabs.
    setImportReceipt(null)
    setUndoError('')
    try {
      const stored = JSON.parse(localStorage.getItem(IMPORT_RESTORE_STORAGE_KEY) || 'null')
      const valid = validImportRestorePoint(stored, userId, gameMode)
      setImportRestorePoint(valid)
      if (!valid && stored?.expiresAt && stored.expiresAt <= Date.now()) localStorage.removeItem(IMPORT_RESTORE_STORAGE_KEY)
    } catch {
      setImportRestorePoint(null)
    }
  }, [gameMode, userId])

  // History belongs to one character, so a mode switch invalidates what is loaded.
  useEffect(() => {
    setHistoryRows(null)
    setHistoryExpanded(false)
  }, [gameMode, userId])

  const snapKey = userId ? `tarkov_quests_${userId}_${gameMode}` : null
  // Snapshots predating mode scoping were saved unsuffixed, and every quest row
  // they hold backfilled to regular — so surface them there and nowhere else.
  const legacySnapKey = userId && gameMode === 'regular' ? `tarkov_quests_${userId}` : null
  const [snapshot, setSnapshot] = useState(null)
  useEffect(() => {
    if (!snapKey) {
      setSnapshot(null)
      return
    }
    try {
      const stored = localStorage.getItem(snapKey)
        || (legacySnapKey ? localStorage.getItem(legacySnapKey) : null)
      setSnapshot(stored ? validSnapshot(JSON.parse(stored), gameMode) : null)
    } catch { setSnapshot(null) }
  }, [snapKey, legacySnapKey])
  const [confirmRestore, setConfirmRestore] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [restoreError, setRestoreError] = useState('')

  function handleSaveSnapshot() {
    if (!snapKey) return
    const snap = { savedAt: new Date().toISOString(), gameMode, quests: userQuests }
    try {
      localStorage.setItem(snapKey, JSON.stringify(snap))
      setSnapshot(snap)
      setRestoreError('')
    } catch {
      setRestoreError('The snapshot could not be saved in this browser. Your current quests are unchanged.')
    }
  }

  async function handleRestore() {
    setRestoring(true)
    setRestoreError('')
    try {
      // A saved snapshot holds the active list only, so it must not be treated
      // as authority over completed/failed history.
      await onRestore(snapshot.quests, { scope: 'active' })
      setConfirmRestore(false)
    } catch {
      setRestoreError('The snapshot could not be restored. Your saved quests are unchanged — try again.')
    } finally {
      setRestoring(false)
    }
  }

  // Load tasks for the currently selected search map
  const { tasks, loading: tasksLoading } = useTasks(searchMap === 'any' ? null : searchMap, gameMode)
  // The persistent signed-in sync owner loads the complete task list once;
  // consume it here so opening/closing this route never creates another sync.
  const allTasks = eftLogSync?.allTasks || []
  const kappaIds = useMemo(() => new Set(allTasks.filter(t => t.kappaRequired).map(t => t.id)), [allTasks])
  const taskById = useMemo(() => {
    const index = new Map()
    allTasks.forEach(task => { if (task?.id) index.set(task.id, task) })
    return index
  }, [allTasks])

  const searchHits = useMemo(() => {
    if (searchQ.length < 1) return []
    return tasks
      .filter(t =>
        t.name.toLowerCase().includes(searchQ.toLowerCase()) &&
        !userQuests.find(q => q.quest_id === t.id)
      )
      .slice(0, 12)
  }, [searchQ, tasks, userQuests])

  // One enriched row per saved quest: the upstream task carries the trader art,
  // level gate and objective count the row renders.
  const enriched = useMemo(() => userQuests.map(quest => {
    const task = taskById.get(quest.quest_id) || null
    return {
      quest,
      task,
      kappa: kappaIds.has(quest.quest_id),
      trader: task?.trader?.name || '',
      mapNorm: quest.map_norm || null,
    }
  }), [userQuests, taskById, kappaIds])

  const filtered = useMemo(() => {
    const needle = listQuery.trim().toLowerCase()
    return enriched.filter(row => {
      if (mapFilter === ANY_MAP_KEY && row.mapNorm) return false
      if (mapFilter !== 'all' && mapFilter !== ANY_MAP_KEY && row.mapNorm !== mapFilter) return false
      if (kappaOnly && !row.kappa) return false
      if (!needle) return true
      const haystack = [
        row.quest.quest_name || '',
        row.trader,
        mapLabel(row.mapNorm),
      ].join(' ').toLowerCase()
      return haystack.includes(needle)
    })
  }, [enriched, mapFilter, kappaOnly, listQuery])

  const orderIndex = useMemo(() => {
    const index = new Map()
    questOrder.forEach((id, position) => index.set(id, position))
    return index
  }, [questOrder])

  const orderedFiltered = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const ai = orderIndex.has(a.quest.quest_id) ? orderIndex.get(a.quest.quest_id) : Number.MAX_SAFE_INTEGER
      const bi = orderIndex.has(b.quest.quest_id) ? orderIndex.get(b.quest.quest_id) : Number.MAX_SAFE_INTEGER
      return ai - bi
    })
  }, [filtered, orderIndex])

  // Groups are the page's spine: one card per map, biggest first, ANY MAP last.
  const groups = useMemo(() => {
    const byMap = new Map()
    orderedFiltered.forEach(row => {
      const key = row.mapNorm || ANY_MAP_KEY
      if (!byMap.has(key)) byMap.set(key, [])
      byMap.get(key).push(row)
    })
    const featuredRank = new Map(FEATURED.map((norm, i) => [norm, i]))
    return [...byMap.entries()]
      .map(([key, rows]) => ({
        key,
        mapNorm: key === ANY_MAP_KEY ? null : key,
        rows,
        kappa: rows.filter(row => row.kappa).length,
        skipped: rows.filter(row => row.quest.skipped).length,
      }))
      .sort((a, b) => {
        if (a.key === ANY_MAP_KEY) return 1
        if (b.key === ANY_MAP_KEY) return -1
        if (b.rows.length !== a.rows.length) return b.rows.length - a.rows.length
        const ar = featuredRank.has(a.key) ? featuredRank.get(a.key) : Number.MAX_SAFE_INTEGER
        const br = featuredRank.has(b.key) ? featuredRank.get(b.key) : Number.MAX_SAFE_INTEGER
        return ar - br
      })
  }, [orderedFiltered])

  const mapCounts = useMemo(() => {
    const counts = { all: userQuests.length, any: 0 }
    userQuests.forEach(q => {
      if (!q.map_norm) counts.any = (counts.any || 0) + 1
      else counts[q.map_norm] = (counts[q.map_norm] || 0) + 1
    })
    return counts
  }, [userQuests])

  // The banner wears the map the player has the most to do on.
  const bannerMap = useMemo(() => {
    let best = null
    let bestCount = 0
    FEATURED.forEach(norm => {
      const count = mapCounts[norm] || 0
      if (count > bestCount) { best = norm; bestCount = count }
    })
    return best
  }, [mapCounts])

  const starredCount = useMemo(() => userQuests.filter(q => q.important && !q.skipped).length, [userQuests])
  const skippedCount = useMemo(() => userQuests.filter(q => q.skipped).length, [userQuests])
  const kappaCount = useMemo(() => userQuests.filter(q => kappaIds.has(q.quest_id)).length, [userQuests, kappaIds])

  const lastSyncedAt = useMemo(() => {
    const stamps = [companion?.desktopLastSuccessfulSync, eftLogSync?.lastSuccessfulCheck]
      .map(value => (value ? new Date(value).getTime() : NaN))
      .filter(value => Number.isFinite(value))
    return stamps.length ? Math.max(...stamps) : null
  }, [companion?.desktopLastSuccessfulSync, eftLogSync?.lastSuccessfulCheck])
  const syncedLabel = lastSyncedAt ? relativeTime(lastSyncedAt) : null

  // -- Ordering ------------------------------------------------------------
  // questOrder is the flat list the party reads as priority, so a drop between
  // groups is the same splice as a drop inside one.
  const reorder = useCallback((movedId, targetId) => {
    if (!movedId || !targetId || movedId === targetId) return
    setQuestOrder(prev => {
      const from = prev.indexOf(movedId)
      const to = prev.indexOf(targetId)
      if (from === -1 || to === -1) return prev
      const next = [...prev]
      next.splice(from, 1)
      // After the removal the target sits one slot earlier when moving down, so
      // the same index lands before it moving up and after it moving down.
      next.splice(to, 0, movedId)
      return next
    })
  }, [])

  function moveRelative(questId, delta) {
    const flat = groups.flatMap(group => (collapsedMaps.has(group.key) ? [] : group.rows))
    const position = flat.findIndex(row => row.quest.quest_id === questId)
    const neighbour = flat[position + delta]
    if (position === -1 || !neighbour) return
    refocusHandleRef.current = questId
    reorder(questId, neighbour.quest.quest_id)
  }

  useEffect(() => {
    const pending = refocusHandleRef.current
    if (!pending) return
    refocusHandleRef.current = null
    handleRefs.current.get(pending)?.focus?.()
  })

  // Mouse keeps the native drag path; touch and pen come through here.
  function beginPointerDrag(event, questId) {
    if (event.pointerType === 'mouse') return
    event.preventDefault()
    pointerDragRef.current = { pointerId: event.pointerId, questId, overId: null }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDragId(questId)
  }

  function movePointerDrag(event) {
    const drag = pointerDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    const row = document.elementFromPoint?.(event.clientX, event.clientY)?.closest?.('.quest-row')
    const overId = row?.dataset?.questId || null
    drag.overId = overId
    setDropId(current => (current === overId ? current : overId))
  }

  function endPointerDrag(event, { commit }) {
    const drag = pointerDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    pointerDragRef.current = null
    if (commit && drag.overId) reorder(drag.questId, drag.overId)
    setDragId(null)
    setDropId(null)
  }

  function handleRowKeyDown(event, questId) {
    if (!event.altKey) return
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    moveRelative(questId, event.key === 'ArrowUp' ? -1 : 1)
  }

  // -- Selection -----------------------------------------------------------
  function toggleSelected(questId) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(questId)) next.delete(questId)
      else next.add(questId)
      return next
    })
  }

  async function runBulk(action) {
    const ids = [...selectedIds]
    setSelectedIds(new Set())
    for (const id of ids) {
      try { await action(id) } catch { /* one failed row must not strand the rest */ }
    }
  }

  function toggleCollapsed(key) {
    setCollapsedMaps(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      try { localStorage.setItem(COLLAPSED_MAPS_STORAGE_KEY, JSON.stringify([...next])) } catch { /* the session still collapses */ }
      return next
    })
  }

  function handleAdd(task) {
    const autoMap = inferredTaskMapNorm(task)
    onAdd({ id: task.id, name: task.name }, autoMap)
    setSearchQ('')
    setRecentlyAdded(prev => new Set([...prev, task.id]))
    setTimeout(() => {
      setRecentlyAdded(prev => { const n = new Set(prev); n.delete(task.id); return n })
    }, 2800)
  }

  function focusManualSearch() {
    setSearchOpen(true)
    searchInputRef.current?.focus()
    searchInputRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  }

  // -- History -------------------------------------------------------------
  const loadHistory = useCallback(async () => {
    if (typeof onGetQuestHistory !== 'function') {
      setHistoryRows([])
      return
    }
    setHistoryLoading(true)
    try {
      const rows = await onGetQuestHistory(HISTORY_LIMIT)
      setHistoryTruncated(Array.isArray(rows) && rows.length >= HISTORY_LIMIT)
      setHistoryRows(Array.isArray(rows) ? rows.filter(row => row?.state === 'completed' || row?.state === 'failed') : [])
    } catch {
      setHistoryRows([])
    } finally {
      setHistoryLoading(false)
    }
  }, [onGetQuestHistory])

  function toggleHistory() {
    const next = !historyOpen
    setHistoryOpen(next)
    if (next && historyRows === null && !historyLoading) loadHistory()
  }

  function reactivate(row) {
    onAdd({ id: row.quest_id, name: row.quest_name }, row.map_norm || null)
    setHistoryRows(prev => (prev ? prev.filter(entry => entry.quest_id !== row.quest_id) : prev))
    setRecentlyAdded(prev => new Set([...prev, row.quest_id]))
    setTimeout(() => {
      setRecentlyAdded(prev => { const n = new Set(prev); n.delete(row.quest_id); return n })
    }, 2800)
  }

  const historyCompleted = historyRows ? historyRows.filter(row => row.state === 'completed').length : 0
  const historyFailed = historyRows ? historyRows.filter(row => row.state === 'failed').length : 0
  // getQuestHistory bounds to HISTORY_LIMIT, so a full page means there may be more.
  const [historyTruncated, setHistoryTruncated] = useState(false)
  const historyVisible = historyRows
    ? (historyExpanded ? historyRows : historyRows.slice(0, HISTORY_PREVIEW_ROWS))
    : []

  async function handleImportStart() {
    let restoreRows = userQuests
    if (typeof onGetQuestHistory === 'function') {
      try {
        const history = await onGetQuestHistory(1000)
        if (Array.isArray(history) && (history.length > 0 || userQuests.length === 0)) restoreRows = history
      } catch {
        // The active list is still a safe fallback when history is unavailable.
      }
    }
    const restorePoint = {
      version: 1,
      userId,
      gameMode,
      savedAt: Date.now(),
      expiresAt: Date.now() + IMPORT_RESTORE_TTL_MS,
      quests: restoreRows.map(quest => ({ ...quest })),
    }
    setImportRestorePoint(restorePoint)
    try { localStorage.setItem(IMPORT_RESTORE_STORAGE_KEY, JSON.stringify(restorePoint)) } catch { /* the in-memory affordance still works */ }
    setImportReceipt(null)
  }

  function handleImportComplete(result = {}) {
    const receipt = Array.isArray(result)
      ? { source: 'logs', questIds: result, applied: result.length }
      : result
    const ids = Array.isArray(receipt?.questIds) ? receipt.questIds.filter(Boolean) : []
    // Every source now reports its batch once, so a receipt describes exactly
    // the import that produced it rather than accumulating across calls.
    setImportReceipt({ ...receipt, questIds: ids })
    // An import rewrites terminal state, so anything already loaded is stale.
    setHistoryRows(null)
    if (!ids.length) return
    setRecentlyAdded(prev => new Set([...prev, ...ids]))
    setTimeout(() => {
      setRecentlyAdded(prev => {
        const next = new Set(prev)
        ids.forEach(id => next.delete(id))
        return next
      })
    }, 2800)
  }

  function handleViewQuests() {
    setHubOpen(false)
    savedQuestsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  async function handleUndoImport() {
    if (!importRestorePoint || importRestorePoint.gameMode !== gameMode || typeof onRestore !== 'function') return
    setUndoingImport(true)
    setUndoError('')
    try {
      // The undo point came from getQuestHistory, so it describes every row in
      // this mode and anything absent from it belongs to the import.
      await onRestore(importRestorePoint.quests, { scope: 'all' })
      setHubOpen(false)
      setImportReceipt(null)
      setImportRestorePoint(null)
      setHistoryRows(null)
      try { localStorage.removeItem(IMPORT_RESTORE_STORAGE_KEY) } catch { /* best effort */ }
    } catch {
      // The restore point is deliberately kept so the user can retry.
      setUndoError('The import could not be undone. Your quests were not changed — try again.')
    } finally {
      setUndoingImport(false)
    }
  }

  const receiptCount = importReceipt?.applied ?? importReceipt?.added ?? importReceipt?.questIds?.length ?? 0
  const receiptStateParts = importReceipt?.states
    ? [
        importReceipt.states.active ? `${importReceipt.states.active} started` : null,
        importReceipt.states.completed ? `${importReceipt.states.completed} completed` : null,
        importReceipt.states.failed ? `${importReceipt.states.failed} failed` : null,
      ].filter(Boolean)
    : []

  const desktopState = companion?.desktopState || (companion?.desktopConnected ? 'connected' : 'not-setup')
  const desktopLabel = {
    connected: 'DESKTOP APP CONNECTED',
    attention: 'DESKTOP APP NEEDS ATTENTION',
    offline: 'DESKTOP APP OFFLINE',
  }[desktopState] || 'DESKTOP APP · NOT SET UP'
  const desktopDetail = desktopState === 'not-setup'
    ? 'SYNCS QUESTS AND PINGS WITH THIS TAB CLOSED.'
    : `LAST REPORT ${relativeTime(companion?.desktopLastSeen) || 'NOT YET'}`

  const now = Date.now()
  const { activeStatus: activeShotStatus, desktopPingsConfigured } = screenshotChannelStatus(screenshotSync, companion, { now })
  const shotSkipped = screenshotSync?.lastSkipped?.count || 0
  const shotStatus = !activeShotStatus
    ? 'UNAVAILABLE'
    : activeShotStatus.source === 'desktop' && activeShotStatus.tone === 'ok'
      ? 'OK'
    : activeShotStatus.source === 'browser' && !screenshotSync?.persistentSupported
      ? 'CHROME / EDGE DESKTOP REQUIRED'
      : activeShotStatus.source === 'browser' && shotSkipped > 0
        ? `${shotSkipped} SCREENSHOT${shotSkipped === 1 ? '' : 'S'} TOO OLD TO PING`
        : activeShotStatus.label || STATE_TEXT?.[screenshotSync?.state] || 'READY'
  const shotRowState = activeShotStatus?.tone === 'ok'
    ? 'connected'
    : ['warn', 'connecting'].includes(activeShotStatus?.tone)
      ? 'attention'
      : activeShotStatus?.tone === 'error'
        ? 'offline'
        : 'not-setup'
  const shotDetail = activeShotStatus?.source === 'desktop'
    ? desktopPingsConfigured
      ? `CONFIGURED IN DESKTOP APP · LAST REPORT ${relativeTime(activeShotStatus.lastReportedMs, now) || 'NOT YET'}`
      : 'NO SCREENSHOTS FOLDER CONFIGURED IN THE DESKTOP APP.'
    : screenshotSync?.folderName
      ? `${screenshotSync.folderName} · ONLY THE FILENAME AND FILE TIME ARE READ.`
      : 'ONLY THE FILENAME AND FILE TIME ARE READ.'

  const searchMapChips = searchMapsOpen ? FEATURED : FEATURED.slice(0, 2)
  const selectionSize = selectedIds.size

  return (
    <div className="quest-page">
      <header className="room-banner quest-banner">
        <div className="room-banner-art" aria-hidden="true">
          <div className="room-banner-layer" style={{ backgroundImage: mapBannerLayers(bannerMap) || BANNER_FALLBACK }} />
          <div className="room-banner-fade" />
          <div className="room-banner-vignette" />
          <div className="room-banner-underline" />
        </div>
        <div className="room-banner-row">
          <div className="room-banner-identity">
            <span className="room-banner-rail" aria-hidden="true" />
            <div className="room-banner-identity-copy">
              <div className="mono room-banner-meta">
                <span className="room-banner-meta-label">QUEST LOADOUT</span>
                <span className="room-banner-meta-divider" aria-hidden="true" />
                <span className="room-banner-mode">{gameModeLabel(gameMode).toUpperCase()}</span>
                <span className="room-banner-meta-divider" aria-hidden="true" />
                <span className="room-banner-readout">SAVED BETWEEN SESSIONS</span>
              </div>
              <h1 className="room-banner-title">QUEST MANAGER</h1>
              <div className="mono quest-banner-readouts">
                <span className="quest-banner-active">{userQuests.length} ACTIVE</span>
                <span className="room-banner-meta-divider" aria-hidden="true" />
                <span>★ {starredCount} STARRED</span>
                <span className="room-banner-meta-divider" aria-hidden="true" />
                <span>⊘ {skippedCount} SKIPPED</span>
                <span className="room-banner-meta-divider" aria-hidden="true" />
                <span>κ {kappaCount} KAPPA</span>
                {syncedLabel && <>
                  <span className="room-banner-meta-divider" aria-hidden="true" />
                  <span className="quest-banner-synced">SYNCED {syncedLabel}</span>
                </>}
              </div>
            </div>
          </div>
          <div className="room-banner-spacer" />
          <div className="room-banner-controls">
            <div className="quest-banner-mode">
              <span className="mono">MODE</span>
              <div className="quest-banner-mode-options" role="group" aria-label="Character game mode">
                {GAME_MODES.map(value => (
                  <button
                    key={value}
                    className={gameMode === value ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'}
                    onClick={() => onSetUserSetting?.('game_mode', value)}
                    disabled={!canChangeGameMode}
                    aria-pressed={gameMode === value}
                  >
                    {gameModeLabel(value)}
                  </button>
                ))}
              </div>
            </div>
            <button className="btn-gold quest-banner-cta" onClick={() => setHubOpen(true)}>GET YOUR QUESTS IN</button>
            {inParty && (
              <button className="room-banner-btn" onClick={onDone}>
                <Icon name="arrow-left" size="sm" /> BACK TO PARTY
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="quest-toolbar">
        <div className="quest-toolbar-row">
          <div className="quest-search">
            <input
              aria-label="Search your quests"
              placeholder="Search your quests, traders or maps…"
              value={listQuery}
              onChange={e => setListQuery(e.target.value)}
            />
            <span className="mono quest-search-glyph" aria-hidden="true">⌕</span>
          </div>
          <div className="quest-chips" role="group" aria-label="Filter by map">
            {[
              { key: 'all', label: `ALL ${mapCounts.all}` },
              ...FEATURED.filter(n => mapCounts[n]).map(n => ({ key: n, label: `${mapLabel(n)} ${mapCounts[n]}` })),
              ...(mapCounts.any ? [{ key: ANY_MAP_KEY, label: `ANY MAP ${mapCounts.any}` }] : []),
            ].map(({ key, label }) => (
              <button
                key={key}
                className={`mono quest-chip${mapFilter === key ? ' is-active' : ''}`}
                onClick={() => setMapFilter(key)}
                aria-pressed={mapFilter === key}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="quest-kappa-only">
            <span className="mono" id={kappaOnlyId}>κ ONLY</span>
            <button
              type="button"
              className="quest-switch"
              aria-pressed={kappaOnly}
              aria-labelledby={kappaOnlyId}
              onClick={() => setKappaOnly(value => !value)}
            >
              <span className="quest-switch-knob" aria-hidden="true" />
            </button>
          </div>
        </div>
        {selectionSize > 0 && (
          <div className="quest-bulkbar" role="status">
            <span className="mono quest-bulk-count">{selectionSize} SELECTED</span>
            <button className="quest-bulk-btn is-done" onClick={() => runBulk(id => onMarkCompleted?.(id))}>✓ MARK DONE</button>
            <button className="quest-bulk-btn" onClick={() => runBulk(id => {
              const row = userQuests.find(q => q.quest_id === id)
              if (!row?.skipped) return onToggleSkipped(id)
              return undefined
            })}>⊘ SKIP</button>
            <button className="quest-bulk-btn is-star" onClick={() => runBulk(id => {
              const row = userQuests.find(q => q.quest_id === id)
              if (!row?.important) return onToggleImportant(id)
              return undefined
            })}>★ STAR</button>
            <button className="quest-bulk-btn is-remove" onClick={() => runBulk(id => onRemove(id))}>× REMOVE</button>
            <button className="quest-bulk-clear" onClick={() => setSelectedIds(new Set())}>CLEAR SELECTION</button>
            <span className="mono quest-bulk-hint">DRAG ⠿ TO REORDER · ORDER SETS PARTY PRIORITY</span>
          </div>
        )}
      </div>

      {inParty && (
        <div className="mono quest-party-notice">
          ◆ YOUR PARTY IS STILL ACTIVE — CHANGES HERE WON'T AFFECT THE CURRENT RAID
        </div>
      )}

      <div className="quest-layout">
        <main className="quest-main" ref={savedQuestsRef}>
          {userQuests.length === 0 ? (
            <QuestEmptyState onOpenHub={() => setHubOpen(true)} onManualSearch={focusManualSearch} />
          ) : groups.length === 0 ? (
            <div className="quest-group">
              <div className="mono quest-group-empty">NO QUESTS FOR THIS FILTER</div>
            </div>
          ) : groups.map(group => {
            const collapsed = collapsedMaps.has(group.key)
            const art = group.mapNorm ? mapHeaderBanner(group.mapNorm) : null
            const metaParts = group.mapNorm
              ? [group.kappa ? `${group.kappa} κ` : null, group.skipped ? `${group.skipped} SKIPPED` : null].filter(Boolean)
              : ['SHOWN ON EVERY MAP', group.kappa ? `${group.kappa} κ` : null].filter(Boolean)
            return (
              <section className="quest-group" key={group.key} aria-label={mapLabel(group.mapNorm)}>
                <div className={`quest-group-head${art ? '' : ' is-artless'}`}>
                  {art && <>
                    <div className="quest-group-art" style={{ backgroundImage: `url('${art}')` }} aria-hidden="true" />
                    <div className="quest-group-scrim" aria-hidden="true" />
                  </>}
                  <div className="quest-group-rail" aria-hidden="true" />
                  <div className="quest-group-row">
                    <h2 className="quest-group-title">{mapLabel(group.mapNorm)}</h2>
                    <span className="mono quest-group-count">{group.rows.length} QUEST{group.rows.length === 1 ? '' : 'S'}</span>
                    {metaParts.length > 0 && <span className="mono quest-group-meta">· {metaParts.join(' · ')}</span>}
                    <button
                      className="quest-group-collapse"
                      onClick={() => toggleCollapsed(group.key)}
                      aria-expanded={!collapsed}
                    >
                      {collapsed ? 'EXPAND' : 'COLLAPSE'}
                    </button>
                  </div>
                </div>
                {!collapsed && (
                  <div className="quest-group-rows">
                    {group.rows.map(({ quest: q, task, kappa }) => (
                      <div
                        key={q.quest_id}
                        data-quest-id={q.quest_id}
                        className={[
                          'quest-row',
                          q.important && !q.skipped ? 'is-starred' : '',
                          q.skipped ? 'is-skipped' : '',
                          dropId === q.quest_id ? 'is-drop-target' : '',
                          recentlyAdded.has(q.quest_id) ? 'quest-new-flash' : '',
                        ].filter(Boolean).join(' ')}
                        onDragOver={event => { if (dragId) { event.preventDefault(); setDropId(q.quest_id) } }}
                        onDragLeave={() => setDropId(current => (current === q.quest_id ? null : current))}
                        onDrop={event => {
                          event.preventDefault()
                          reorder(dragId, q.quest_id)
                          setDragId(null)
                          setDropId(null)
                        }}
                      >
                        <button
                          type="button"
                          className="quest-row-handle"
                          ref={node => {
                            if (node) handleRefs.current.set(q.quest_id, node)
                            else handleRefs.current.delete(q.quest_id)
                          }}
                          draggable
                          onDragStart={event => { setDragId(q.quest_id); event.dataTransfer.effectAllowed = 'move' }}
                          onDragEnd={() => { setDragId(null); setDropId(null) }}
                          onPointerDown={event => beginPointerDrag(event, q.quest_id)}
                          onPointerMove={movePointerDrag}
                          onPointerUp={event => endPointerDrag(event, { commit: true })}
                          onPointerCancel={event => endPointerDrag(event, { commit: false })}
                          onKeyDown={event => handleRowKeyDown(event, q.quest_id)}
                          title="Drag to reorder — or Alt + arrow keys"
                          aria-label={`Reorder ${q.quest_name}. Hold Alt and press the up or down arrow to move it.`}
                        >⠿</button>

                        <input
                          type="checkbox"
                          className="quest-row-check"
                          checked={selectedIds.has(q.quest_id)}
                          onChange={() => toggleSelected(q.quest_id)}
                          aria-label={`Select ${q.quest_name}`}
                        />

                        <button
                          className="quest-row-star"
                          onClick={() => onToggleImportant(q.quest_id)}
                          title="Mark as important — will be starred when joining a party"
                          aria-label={q.important ? `Remove important from ${q.quest_name}` : `Mark ${q.quest_name} as important`}
                          aria-pressed={!!q.important}
                        >★</button>

                        {/* An absent portrait leaves the empty slot: a monogram would
                            read as a different kind of quest rather than missing art. */}
                        <span className="quest-row-trader" title={task?.trader?.name || undefined}>
                          {task?.trader?.imageLink && <img src={task.trader.imageLink} alt={task.trader.name} />}
                        </span>

                        <div className="quest-row-copy">
                          <div className="quest-row-title-line">
                            <span className="quest-row-name">{q.quest_name}</span>
                            {kappa && <KappaBadge />}
                            {q.skipped && <span className="mono quest-row-skipped-tag">⊘ SKIPPED</span>}
                          </div>
                          <div className="quest-row-meta">
                            {task?.trader?.name && <span className="quest-row-pill">{task.trader.name.toUpperCase()}</span>}
                            {task?.minPlayerLevel > 0 && <span className="quest-row-pill">LV. {task.minPlayerLevel}</span>}
                            {task?.objectives?.length > 0 && (
                              <span className="quest-row-objectives">
                                {task.objectives.length} OBJECTIVE{task.objectives.length === 1 ? '' : 'S'}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="quest-row-actions">
                          <button
                            className="quest-row-btn is-done"
                            onClick={() => onMarkCompleted?.(q.quest_id)}
                            title="Mark as done — retains completion history and removes from your active list"
                          >✓ DONE</button>
                          <button
                            className={`quest-row-btn ${q.skipped ? 'is-unskip' : 'is-skip'}`}
                            onClick={() => onToggleSkipped(q.quest_id)}
                            title={q.skipped ? 'Un-skip' : 'Skip — will be pre-skipped in party UI'}
                          >{q.skipped ? 'UNSKIP' : '⊘ SKIP'}</button>
                          <button
                            className="quest-row-btn is-remove"
                            onClick={() => onRemove(q.quest_id)}
                            aria-label={`Remove ${q.quest_name}`}
                            title="Remove from saved list"
                          >×</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )
          })}

          <section className="quest-history" aria-label="Quest history">
            <div className="quest-history-head">
              <span className="lbl">HISTORY</span>
              {historyRows && <>
                <span className="mono quest-history-count">{historyCompleted} COMPLETED</span>
                <span className="mono quest-history-count is-failed">{historyFailed} FAILED</span>
              </>}
              <button className="btn-ghost btn-sm" onClick={toggleHistory} aria-expanded={historyOpen}>
                {historyOpen ? 'HIDE HISTORY' : 'SHOW HISTORY'}
              </button>
            </div>
            {historyOpen && (
              historyLoading
                ? <div className="mono quest-history-empty">LOADING HISTORY…</div>
                : historyVisible.length === 0
                  ? <div className="quest-history-empty">Nothing completed or failed on this character yet.</div>
                  : (
                      <div className="quest-history-rows">
                        {historyVisible.map(row => {
                          const task = taskById.get(row.quest_id)
                          const stamp = historyDate(row.state_at)
                          const meta = [task?.trader?.name?.toUpperCase(), stamp].filter(Boolean).join(' · ')
                          return (
                            <div className={`quest-history-row${row.state === 'failed' ? ' is-failed' : ''}`} key={row.quest_id}>
                              <span className="mono quest-history-state">{row.state === 'failed' ? '✕ FAILED' : '✓ DONE'}</span>
                              <span className="quest-history-name">{row.quest_name}</span>
                              {meta && <span className="mono quest-history-meta">{meta}</span>}
                              <button className="quest-history-reactivate" onClick={() => reactivate(row)}>REACTIVATE</button>
                            </div>
                          )
                        })}
                        {!historyExpanded && historyRows.length > HISTORY_PREVIEW_ROWS && (
                          <button className="btn-ghost btn-sm quest-history-more" onClick={() => setHistoryExpanded(true)}>
                            SHOW ALL {historyRows.length} RECORDS
                          </button>
                        )}
                        {/* "All" of a capped set reads as data loss unless the cap says so. */}
                        {historyTruncated && (
                          <div className="mono quest-rail-note">SHOWING THE MOST RECENT {HISTORY_LIMIT} RECORDS</div>
                        )}
                      </div>
                    )
            )}
          </section>
        </main>

        <aside className="quest-aside">
          {importReceipt && (
            <div className={`quest-import-receipt quest-import-receipt-rail${importReceipt.undone ? ' is-undone' : ''}`} role="status">
              <div className="quest-import-receipt-copy">
                <div className="mono quest-import-receipt-title">{importReceipt.undone ? 'IMPORT UNDONE' : 'IMPORT COMPLETE'}</div>
                <p>
                  {importReceipt.undone
                    ? `Restored ${importReceipt.restoredCount ?? userQuests.length} quest records from before the import.`
                    : `${receiptCount} quest state${receiptCount === 1 ? '' : 's'} updated${receiptStateParts.length ? ` · ${receiptStateParts.join(' · ')}` : ''}.${importReceipt.syncEnabled ? ' Browser sync is on while this tab stays open.' : ''}`}
                </p>
              </div>
              <div className="quest-import-receipt-actions">
                {!importReceipt.undone && <button className="btn-ghost btn-sm" onClick={handleViewQuests}>VIEW MY QUESTS</button>}
                {!importReceipt.undone && importRestorePoint && (
                  <button className="btn-ghost btn-sm" onClick={handleUndoImport} disabled={undoingImport}>
                    {undoingImport ? 'RESTORING...' : 'UNDO IMPORT'}
                  </button>
                )}
                <button className="btn-ghost btn-sm" onClick={() => { setImportReceipt(null); setUndoError('') }}>DISMISS</button>
              </div>
              {undoError && <p className="mono eft-log-import-error" role="alert">{undoError}</p>}
            </div>
          )}

          {!importReceipt && importRestorePoint && (
            <div className="quest-import-receipt quest-import-receipt-rail" role="status">
              <div className="quest-import-receipt-copy">
                <div className="mono quest-import-receipt-title">IMPORT RESTORE AVAILABLE</div>
                <p>This undo point is available until {new Date(importRestorePoint.expiresAt).toLocaleString()} for this character mode.</p>
              </div>
              <div className="quest-import-receipt-actions">
                <button className="btn-ghost btn-sm" onClick={handleUndoImport} disabled={undoingImport}>{undoingImport ? 'RESTORING...' : 'UNDO IMPORT'}</button>
              </div>
              {undoError && <p className="mono eft-log-import-error" role="alert">{undoError}</p>}
            </div>
          )}

          <div className="quest-rail-card">
            <div className="lbl">SYNC SOURCES</div>
            <div className="quest-sync-row" data-state={desktopState}>
              <span className="quest-sync-dot" aria-hidden="true" />
              <div className="quest-sync-copy">
                <div className="mono quest-sync-label">{desktopLabel}</div>
                <div className="mono quest-sync-detail">{desktopDetail}</div>
              </div>
            </div>
            <div className="quest-sync-row" data-state={shotRowState}>
              <span className="quest-sync-dot" aria-hidden="true" />
              <div className="quest-sync-copy">
                <div className="mono quest-sync-label">SCREENSHOT PINGS · {shotStatus}</div>
                <div className="mono quest-sync-detail">{shotDetail}</div>
              </div>
            </div>
            <div className="quest-rail-actions">
              {screenshotSync?.persistentSupported && !screenshotSync.folderName && !desktopPingsConfigured && (
                <button
                  className="btn-gold btn-sm"
                  disabled={screenshotSync.state === 'reading'}
                  onClick={() => { screenshotSync.connect().catch(() => {}) }}
                >CHOOSE SCREENSHOTS</button>
              )}
              {screenshotSync?.folderName && screenshotSync.state === 'permission-needed' && (
                <button className="btn-gold btn-sm" onClick={() => screenshotSync.reconnect()}>RECONNECT</button>
              )}
              {screenshotSync?.folderName && screenshotSync.state !== 'permission-needed' && (
                <button className="btn-ghost btn-sm" disabled={screenshotSync.state === 'reading'} onClick={() => screenshotSync.checkNow()}>CHECK</button>
              )}
              {screenshotSync?.folderName && (
                <button className="btn-ghost btn-sm" onClick={() => screenshotSync.forget()}>FORGET</button>
              )}
              <button className="btn-ghost btn-sm" onClick={() => setHubOpen(true)}>MANAGE IMPORTS</button>
            </div>
            {screenshotSync?.error && <div className="mono quest-rail-error" role="alert">{screenshotSync.error}</div>}
          </div>

          {snapKey && (userQuests.length > 0 || snapshot) && (
            <div className="quest-rail-card">
              <div className="lbl">SNAPSHOT</div>
              <p className="quest-rail-copy">A snapshot stores your active list in this browser so you can roll back a bad import.</p>
              <div className="quest-rail-actions">
                <button className="btn-ghost btn-sm" onClick={handleSaveSnapshot} disabled={userQuests.length === 0}>
                  ↓ SAVE ({userQuests.length})
                </button>
                {snapshot && !confirmRestore && (
                  <button className="btn-ghost btn-sm" onClick={() => setConfirmRestore(true)} style={{ color: 'var(--gold)' }}>
                    ↑ RESTORE · {snapshot.quests.length}
                  </button>
                )}
                {snapshot && confirmRestore && (
                  <>
                    <button className="btn-danger btn-sm" onClick={handleRestore} disabled={restoring}>
                      {restoring ? 'RESTORING...' : 'YES, RESTORE'}
                    </button>
                    <button className="btn-ghost btn-sm" onClick={() => setConfirmRestore(false)}>CANCEL</button>
                  </>
                )}
              </div>
              {snapshot && confirmRestore && (
                <div className="mono quest-rail-confirm">
                  REPLACE {userQuests.length} CURRENT QUESTS WITH {snapshot.quests.length} FROM SNAPSHOT?
                </div>
              )}
              {snapshot && !confirmRestore && (
                <div className="mono quest-rail-note">SAVED {new Date(snapshot.savedAt).toLocaleDateString()}</div>
              )}
              {restoreError && <div className="mono quest-rail-error" role="alert">{restoreError}</div>}
            </div>
          )}

          <div className="quest-rail-card">
            <div className="lbl">ADD ONE MANUALLY</div>
            <div className="quest-manual">
              {tasksLoading && searchMap !== 'any'
                ? <div className="mono quest-rail-note">LOADING QUESTS...</div>
                : <input
                    ref={searchInputRef}
                    aria-label="Search saved quests"
                    placeholder={`Search quests${searchMap !== 'any' ? ` for ${MAP_NAMES[searchMap] || searchMap}` : ' (any map)'}...`}
                    value={searchQ}
                    onChange={e => { setSearchQ(e.target.value); setSearchOpen(true) }}
                    onFocus={() => setSearchOpen(true)}
                    onBlur={() => setTimeout(() => setSearchOpen(false), 160)}
                  />
              }

              {searchOpen && searchHits.length > 0 && (
                <div className="quest-manual-results">
                  {searchHits.map(t => (
                    <button type="button" key={t.id}
                      className="quest-manual-result"
                      onMouseDown={event => event.preventDefault()}
                      onClick={() => handleAdd(t)}
                    >
                      <span className="quest-manual-result-copy">
                        <span className="quest-manual-result-name">
                          {t.name}
                          {t.kappaRequired && <KappaBadge />}
                        </span>
                        <span className="quest-manual-result-meta">
                          {t.trader?.name} · Lv.{t.minPlayerLevel || 1}
                          {!t.map && ' · any map'}
                        </span>
                      </span>
                      <span className="quest-manual-result-add" aria-hidden="true">+</span>
                    </button>
                  ))}
                </div>
              )}

              {searchOpen && searchQ.length >= 1 && searchHits.length === 0 && !tasksLoading && (
                <div className="mono quest-manual-empty">NO RESULTS FOR "{searchQ.toUpperCase()}"</div>
              )}
            </div>
            <div className="quest-manual-chips" role="group" aria-label="Filter the task list by map">
              <button
                className={`mono quest-chip${searchMap === 'any' ? ' is-active' : ''}`}
                onClick={() => setSearchMap('any')}
                aria-pressed={searchMap === 'any'}
              >ANY MAP</button>
              {searchMapChips.map(norm => (
                <button key={norm}
                  className={`mono quest-chip${searchMap === norm ? ' is-active' : ''}`}
                  onClick={() => setSearchMap(norm)}
                  aria-pressed={searchMap === norm}
                >{mapLabel(norm)}</button>
              ))}
              {!searchMapsOpen && (
                <button className="mono quest-chip" onClick={() => setSearchMapsOpen(true)}>MORE…</button>
              )}
            </div>
          </div>

          {userQuests.length > 0 && (
            <div className="quest-rail-card">
              <div className="lbl">DANGER ZONE</div>
              {confirmClear ? (
                <>
                  <div className="mono quest-rail-confirm">CLEAR ALL {userQuests.length} QUESTS?</div>
                  <div className="quest-rail-actions">
                    <button className="btn-danger btn-sm" onClick={() => { onClearAll(); setConfirmClear(false) }}>YES, CLEAR</button>
                    <button className="btn-ghost btn-sm" onClick={() => setConfirmClear(false)}>CANCEL</button>
                  </div>
                </>
              ) : (
                <button className="btn-danger btn-sm" onClick={() => setConfirmClear(true)}>
                  CLEAR ALL {userQuests.length} QUESTS
                </button>
              )}
            </div>
          )}

          <div className="mono quest-rail-footnote">
            ★ STARRED QUESTS ARE AUTO-STARRED IN THE PARTY TODO LIST.<br />
            QUESTS ARE AUTO-LOADED WHEN YOU JOIN OR CREATE A PARTY.
          </div>
        </aside>
      </div>

      {hubOpen && (
        <QuestImportHub
          open
          onOpenChange={setHubOpen}
          allTasks={allTasks}
          userQuests={userQuests}
          userId={userId}
          gameMode={gameMode}
          onGetQuestHistory={onGetQuestHistory}
          onApply={onReconcileLogEvents}
          sync={eftLogSync}
          companion={companion}
          onFocusManualSearch={focusManualSearch}
          onImportStart={handleImportStart}
          onImportComplete={handleImportComplete}
          onViewQuests={handleViewQuests}
        />
      )}

      <style>{`
        @keyframes goldFlash {
          0%   { box-shadow: 0 0 0 2px var(--gold); }
          60%  { box-shadow: 0 0 0 2px rgba(201,168,76,0.5); }
          100% { box-shadow: none; }
        }
        .quest-new-flash { animation: goldFlash 2.4s ease forwards; }
      `}</style>
    </div>
  )
}
