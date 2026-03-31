import { useState } from 'react'
import { useMaps, useTasks } from '../useTarkov'
import QuestSearch from './QuestSearch'
import TodoList from './TodoList'
import MapOverlay from './MapOverlay'

function Spinner() {
  return <div style={{ width: 14, height: 14, border: '1px solid var(--brd2)', borderTop: '1px solid var(--gold)', borderRadius: '50%', animation: 'spin .8s linear infinite', flexShrink: 0 }} />
}

export default function Room({ party, myName, onLeave, onSelectMap, onAddQuest, onRemoveQuest, onSetSpawn, onToggleObjective, onToggleStar }) {
  const [tab, setTab]     = useState('quests')
  const [copied, setCopied] = useState(false)

  const { maps, loading: loadingMaps } = useMaps()
  const { tasks, loading: loadingTasks } = useTasks(party.map_norm)

  const isLeader = party.leader === myName
  const members  = Object.keys(party.members || {})
  const mine     = party.members?.[myName] || []

  function copy() {
    navigator.clipboard?.writeText(party.code).catch(() => {})
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>

      {/* Top bar */}
      <div style={{ background: 'var(--bg)', borderBottom: '2px solid var(--brd)', padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div className="serif" style={{ fontSize: 22, color: '#fff' }}>
          Squad<span style={{ color: 'var(--gold)' }}>.</span>gg
          {party.map_name && <span style={{ fontSize: 14, color: 'var(--txm)', marginLeft: 12, fontFamily: 'Share Tech Mono, monospace', letterSpacing: '.06em' }}>/ {party.map_name.toUpperCase()}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--brd2)', borderRadius: 2, padding: '4px 10px' }}>
            <span className="mono" style={{ fontSize: 9, color: 'var(--txm)', letterSpacing: '.1em' }}>PARTY</span>
            <span className="mono" style={{ fontSize: 16, color: 'var(--gold)', letterSpacing: '.22em' }}>{party.code}</span>
            <button className="btn-ghost btn-sm" onClick={copy}>{copied ? '✓' : 'COPY'}</button>
          </div>
          <button className="btn-danger btn-sm" onClick={onLeave}>LEAVE</button>
        </div>
      </div>

      {/* Main layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', flex: 1, overflow: 'hidden' }}>

        {/* Left sidebar */}
        <div style={{ borderRight: '2px solid var(--brd)', display: 'flex', flexDirection: 'column', overflow: 'auto' }}>

          {/* Map list */}
          <div style={{ borderBottom: '2px solid var(--brd)', padding: '12px 14px' }}>
            <div className="lbl">{isLeader ? 'Select map' : 'Map'}</div>
            {loadingMaps
              ? <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Spinner /><span className="mono" style={{ fontSize: 10, color: 'var(--txm)' }}>LOADING...</span></div>
              : maps.map(m => (
                <div key={m.id}
                  onClick={() => isLeader && onSelectMap(m)}
                  className="mono"
                  style={{
                    display: 'block', padding: '6px 8px', fontSize: 11,
                    color: party.map_id === m.id ? 'var(--gold)' : 'var(--txm)',
                    background: party.map_id === m.id ? 'var(--golddim)' : 'transparent',
                    borderLeft: `2px solid ${party.map_id === m.id ? 'var(--gold)' : 'transparent'}`,
                    cursor: isLeader ? 'pointer' : 'default',
                    letterSpacing: '.04em',
                    transition: 'all .1s',
                    opacity: isLeader ? 1 : .7,
                    paddingLeft: party.map_id === m.id ? 6 : 8,
                  }}
                  onMouseEnter={e => { if (isLeader && party.map_id !== m.id) e.currentTarget.style.color = '#aaa' }}
                  onMouseLeave={e => { if (party.map_id !== m.id) e.currentTarget.style.color = 'var(--txm)' }}
                >
                  {m.name.toUpperCase()}
                </div>
              ))
            }
          </div>

          {/* Party members */}
          <div style={{ padding: '12px 14px', borderBottom: '2px solid var(--brd)' }}>
            <div className="lbl">Party</div>
            {members.map(m => (
              <div key={m} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--brd)' }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gold)', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mono" style={{ fontSize: 11, color: m === myName ? 'var(--gold)' : 'var(--tx)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m}{m === myName ? ' ·you' : ''}
                  </div>
                  <div className="mono" style={{ fontSize: 9, color: 'var(--txd)' }}>
                    {(party.members[m] || []).length} QUEST{(party.members[m] || []).length !== 1 ? 'S' : ''}
                  </div>
                </div>
                {party.leader === m && (
                  <span className="mono" style={{ fontSize: 9, color: 'var(--gold)', border: '1px solid var(--golddim)', borderRadius: 2, padding: '1px 4px' }}>LDR</span>
                )}
              </div>
            ))}
          </div>

          {/* All party quests summary */}
          {party.map_id && (
            <div style={{ padding: '12px 14px', flex: 1 }}>
              <div className="lbl">All quests</div>
              {members.map(m => (
                <div key={m} style={{ marginBottom: 10 }}>
                  <div className="mono" style={{ fontSize: 9, color: m === myName ? 'var(--gold)' : 'var(--txm)', marginBottom: 3 }}>{m.toUpperCase()}</div>
                  {!(party.members[m] || []).length
                    ? <div className="mono" style={{ fontSize: 9, color: 'var(--txd)' }}>—</div>
                    : (party.members[m] || []).map(q => (
                      <div key={q.id} className="mono" style={{ fontSize: 10, color: 'var(--txm)', padding: '2px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        / {q.name}
                      </div>
                    ))
                  }
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right content */}
        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {party.map_id ? (
            <>
              {/* Tabs */}
              <div style={{ display: 'flex', borderBottom: '2px solid var(--brd)', flexShrink: 0 }}>
                {[['quests', 'Quests'], ['todo', 'Todo list'], ['map', 'Map / route']].map(([id, lbl]) => (
                  <button key={id} onClick={() => setTab(id)} style={{
                    background: 'none', border: 'none',
                    borderBottom: `2px solid ${tab === id ? 'var(--gold)' : 'transparent'}`,
                    color: tab === id ? 'var(--gold)' : 'var(--txm)',
                    fontFamily: 'Share Tech Mono, monospace', fontSize: 11, letterSpacing: '.08em',
                    padding: '10px 20px', borderRadius: 0, cursor: 'pointer',
                    transition: 'all .15s', marginBottom: -2,
                  }}>{lbl.toUpperCase()}</button>
                ))}
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
                {tab === 'quests' && (
                  <div className="fade-in">
                    <div className="lbl">{myName.toUpperCase()} — your active quests</div>
                    <QuestSearch tasks={tasks} mine={mine} onAdd={onAddQuest} onRemove={onRemoveQuest} loading={loadingTasks} />

                    {members.filter(m => m !== myName).map(m => (
                      <div key={m} style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--brd)' }}>
                        <div className="lbl">{m.toUpperCase()} — quests</div>
                        {!(party.members[m] || []).length
                          ? <p className="mono" style={{ fontSize: 10, color: 'var(--txd)' }}>WAITING FOR {m.toUpperCase()} TO ADD QUESTS</p>
                          : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                            {(party.members[m] || []).map(q => (
                              <span key={q.id} className="mono" style={{ display: 'inline-flex', background: 'var(--sur2)', border: '1px solid var(--brd2)', borderRadius: 2, padding: '2px 7px', fontSize: 10, color: 'var(--txm)' }}>{q.name}</span>
                            ))}
                          </div>
                        }
                      </div>
                    ))}
                  </div>
                )}

                {tab === 'todo' && (
                  <div className="fade-in">
                    <TodoList
                      tasks={tasks}
                      memberQuests={party.members}
                      progress={party.progress || {}}
                      starredQuests={party.starred || {}}
                      onToggleObjective={onToggleObjective}
                      onToggleStar={onToggleStar}
                    />
                  </div>
                )}

                {tab === 'map' && (
                  <div className="fade-in">
                    <MapOverlay
                      mapNorm={party.map_norm}
                      mapName={party.map_name}
                      tasks={tasks}
                      memberQuests={party.members}
                      spawn={party.spawn}
                      onSetSpawn={onSetSpawn}
                      isLeader={isLeader}
                    />
                  </div>
                )}
              </div>
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <div className="serif" style={{ fontSize: 18, color: 'var(--txm)', marginBottom: 8 }}>
                  {isLeader ? 'Select a map to begin' : 'Waiting for leader to select a map'}
                </div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--txd)' }}>
                  {isLeader ? 'CHOOSE FROM THE LIST ON THE LEFT' : 'STAND BY...'}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
