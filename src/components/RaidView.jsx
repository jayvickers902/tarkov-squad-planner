import { useState, useEffect } from 'react'
import MapLeaflet from './MapLeaflet'
import TodoList from './TodoList'

export default function RaidView({
  party, myName, members,
  tasks, allTasks, loadingTasks,
  skippedQuestIds,
  onToggleStar,
  onAddStroke, onClearMyStrokes,
  onAddMarker, onClearMyMarkers,
  onClose,
}) {
  const [pillOpen, setPillOpen] = useState(true)
  const [mapHeight, setMapHeight] = useState(() => window.innerHeight - 40)
  const mine = party.members?.[myName] || []

  useEffect(() => {
    function onResize() { setMapHeight(window.innerHeight - 40) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>

      {/* Top bar */}
      <div style={{
        height: 40, flexShrink: 0,
        display: 'flex', alignItems: 'center',
        padding: '0 12px', gap: 8,
        background: 'var(--sur)', borderBottom: '1px solid var(--brd)',
        zIndex: 10,
      }}>
        <button className="btn-ghost btn-sm" onClick={onClose}>◀ EXIT RAID VIEW</button>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <span className="mono" style={{ fontSize: 9, color: 'var(--gold)', letterSpacing: '.16em' }}>◆ RAID ACTIVE</span>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '.08em', color: 'var(--goldtx)' }}>
            {(party.map_name || '').toUpperCase()}
          </span>
        </div>
        {/* Spacer to visually center the title */}
        <div style={{ width: 110, flexShrink: 0 }} />
      </div>

      {/* Map + floating pill */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <MapLeaflet
          mapNorm={party.map_norm}
          mapName={party.map_name}
          drawings={party.drawings || []}
          markers={party.markers || []}
          myName={myName}
          memberNames={members}
          myQuests={mine}
          memberQuests={party.members || {}}
          tasks={allTasks}
          progress={party.progress || {}}
          onAddStroke={onAddStroke}
          onClearMyStrokes={onClearMyStrokes}
          onAddMarker={onAddMarker}
          onClearMyMarkers={onClearMyMarkers}
          mapHeight={mapHeight}
          defaultMode="pan"
        />

        {/* Floating objectives pill */}
        <div style={{
          position: 'absolute', top: 10, right: 10,
          width: 340, maxWidth: 'calc(100vw - 20px)',
          zIndex: 1000,
          background: 'var(--sur)',
          border: '1px solid var(--brd)',
          borderRadius: 6,
          boxShadow: '0 4px 24px rgba(0,0,0,0.65)',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: 'calc(100% - 20px)',
          overflow: 'hidden',
        }}>
          {/* Pill header */}
          <div
            onClick={() => setPillOpen(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 12px', cursor: 'pointer', flexShrink: 0,
              background: 'var(--sur2)',
              borderBottom: pillOpen ? '1px solid var(--brd)' : 'none',
              userSelect: 'none',
            }}
          >
            <span className="mono" style={{ fontSize: 10, color: 'var(--gold)', letterSpacing: '.12em' }}>◆ SQUAD OBJECTIVES</span>
            <span className="mono" style={{ fontSize: 10, color: 'var(--txd)' }}>{pillOpen ? '▲' : '▼'}</span>
          </div>

          {pillOpen && (
            <div style={{ overflow: 'auto', padding: '12px' }}>
              {loadingTasks ? (
                <div className="mono" style={{ fontSize: 11, color: 'var(--txd)', padding: '8px 0' }}>LOADING...</div>
              ) : (
                <TodoList
                  tasks={tasks}
                  memberQuests={party.members || {}}
                  progress={party.progress || {}}
                  starredQuests={party.starred || {}}
                  onToggleStar={onToggleStar}
                  questOrder={party.quest_order}
                  initialSkipped={skippedQuestIds}
                  myName={myName}
                  mapNorm={party.map_norm}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
