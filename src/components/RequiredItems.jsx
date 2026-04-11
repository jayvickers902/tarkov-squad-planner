import { useMemo, useState } from 'react'
import { useKeys } from '../useTarkov'
import { useMapKeys } from '../useMapKeys'
import { RED_REBEL_MAPS } from '../constants'

const MEMBER_COLORS = [
  { bg: '#1a2e3a', border: '#1e5a7a', text: '#5aace8' },
  { bg: '#2a1a2e', border: '#5a1e7a', text: '#b85ae8' },
  { bg: '#2e1a1a', border: '#7a1e1e', text: '#e85a5a' },
  { bg: '#1a2e1a', border: '#1e7a1e', text: '#5ae85a' },
  { bg: '#2e2a1a', border: '#7a6a1e', text: '#e8c85a' },
  { bg: '#1a2a2e', border: '#1e6a7a', text: '#5ad8e8' },
]

function memberColor(name, allMembers) {
  const idx = allMembers.indexOf(name) % MEMBER_COLORS.length
  return MEMBER_COLORS[Math.max(0, idx)]
}

function objIsOnMap(obj, mapNorm, taskMapNorm) {
  if (!mapNorm) return true
  if (obj.maps && obj.maps.length > 0) return obj.maps.some(m => m.normalizedName === mapNorm)
  if (taskMapNorm) return taskMapNorm === mapNorm
  return true
}

const FMT = new Intl.NumberFormat('en-US')

function Spin() {
  return <div style={{ width: 18, height: 18, border: '2px solid var(--brd2)', borderTop: '2px solid var(--gold)', borderRadius: '50%', animation: 'spin .8s linear infinite', flexShrink: 0 }} />
}

export default function RequiredItems({ tasks, memberQuests, mapNorm, progress }) {
  const members = Object.keys(memberQuests)
  const [activeMember, setActiveMember] = useState('all')
  const { keys, allKeys, loading: keysLoading } = useKeys(mapNorm)
  const { mapKeys } = useMapKeys(mapNorm)

  const priorityKeys = keys
    .filter(k => mapKeys[k.name]?.priority === true)
    .sort((a, b) => (b.avg24hPrice || b.lastLowPrice || 0) - (a.avg24hPrice || a.lastLowPrice || 0))

  const keyIdSet = useMemo(() => new Set(allKeys.map(k => k.id)), [allKeys])

  // Build per-member item lists from their active quests' objectives
  const memberItems = useMemo(() => {
    return members.map(member => {
      // Deduplicate quest IDs — party.members can accumulate duplicates
      const seen = new Set()
      const quests = (memberQuests[member] || []).filter(q => seen.has(q.id) ? false : (seen.add(q.id), true))
      const itemMap = {}

      quests.forEach(q => {
        const task = tasks.find(t => t.id === q.id)
        if (!task) return
        task.objectives?.forEach(obj => {
          if (obj.optional) return
          if (progress?.[`${task.id}::${obj.id}::${member}`]) return
          const isPlant = obj.type === 'plantItem' && obj.item
          const isMark  = obj.type === 'mark' && obj.markerItem
          const isKeyObj = (obj.type === 'findItem' || obj.type === 'giveItem') && obj.item && keyIdSet.has(obj.item.id)
          if (!isPlant && !isMark && !isKeyObj) return
          if (!objIsOnMap(obj, mapNorm, task.map?.normalizedName)) return
          const item = isMark ? obj.markerItem : obj.item
          const count = isPlant || isKeyObj ? (obj.count || 1) : 1
          const mapKey = `${item.id}::bring`
          if (itemMap[mapKey]) {
            itemMap[mapKey].count += count
            if (!itemMap[mapKey].quests.includes(q.name)) itemMap[mapKey].quests.push(q.name)
          } else {
            itemMap[mapKey] = {
              itemId: item.id,
              name: item.name,
              iconLink: item.iconLink || null,
              count,
              foundInRaid: obj.foundInRaid || false,
              isKey: isKeyObj,
              quests: [q.name],
            }
          }

          // Keys required to unlock doors for this objective
          if (obj.requiredKeys?.length && objIsOnMap(obj, mapNorm, task.map?.normalizedName)) {
            obj.requiredKeys.forEach(keyGroup => {
              // keyGroup.items are alternatives — show all options
              keyGroup.items?.forEach(keyItem => {
                const rk = `${keyItem.id}::required`
                if (itemMap[rk]) {
                  if (!itemMap[rk].quests.includes(q.name)) itemMap[rk].quests.push(q.name)
                } else {
                  itemMap[rk] = {
                    itemId: keyItem.id,
                    name: keyItem.name,
                    iconLink: keyItem.iconLink || null,
                    count: 1,
                    foundInRaid: false,
                    isKey: true,
                    quests: [q.name],
                  }
                }
              })
            })
          }
        })
      })

      return { member, items: Object.values(itemMap) }
    })
  }, [tasks, memberQuests, progress, mapNorm, keyIdSet]) // eslint-disable-line

  const hasAnyItems = memberItems.some(m => m.items.length > 0)
  const hasCliffDescent = RED_REBEL_MAPS.has(mapNorm)

  const visible = activeMember === 'all'
    ? memberItems
    : memberItems.filter(m => m.member === activeMember)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Cliff descent reminder */}
      {hasCliffDescent && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px',
          background: 'rgba(201,168,76,0.06)', border: '1px solid var(--golddim)', borderRadius: 4,
        }}>
          <span style={{ fontSize: 18 }}>⛏</span>
          <span style={{ fontSize: 18 }}>🪢</span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--goldtx)', letterSpacing: '.04em' }}>
            CLIFF DESCENT AVAILABLE — BRING RED REBEL ICE PICK + PARACORD
          </span>
        </div>
      )}

      {/* Required items */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
          <h3 style={{ fontSize: 18, color: 'var(--goldtx)' }}>REQUIRED ITEMS</h3>
          <span className="mono" style={{ fontSize: 10, color: 'var(--txd)' }}>ITEMS TO BRING IN FOR ACTIVE QUESTS</span>
        </div>

        {!hasAnyItems ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div className="mono" style={{ fontSize: 12, color: 'var(--txd)', letterSpacing: '.1em' }}>NO ITEM REQUIREMENTS</div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--txd)', marginTop: 8 }}>NO ITEMS NEED TO BE BROUGHT IN FOR ACTIVE QUESTS ON THIS MAP</div>
          </div>
        ) : (
          <>
            {/* Member filter */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
              <button onClick={() => setActiveMember('all')} className={activeMember === 'all' ? 'btn-gold btn-sm' : 'btn-ghost btn-sm'}>ALL</button>
              {members.map(m => {
                const c = memberColor(m, members)
                const active = activeMember === m
                return (
                  <button key={m} onClick={() => setActiveMember(m)} style={{
                    padding: '5px 10px', fontSize: 12, borderRadius: 4,
                    background: active ? c.bg : 'transparent',
                    border: `1px solid ${active ? c.border : 'var(--brd2)'}`,
                    color: active ? c.text : 'var(--txm)',
                    fontFamily: 'Share Tech Mono', letterSpacing: '.04em', transition: 'all .15s',
                  }}>
                    {m.slice(0, 10).toUpperCase()}
                  </button>
                )
              })}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {visible.map(({ member, items }) => {
                const c = memberColor(member, members)
                return (
                  <div key={member}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${c.border}`,
                    }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: c.text, flexShrink: 0 }} />
                      <span className="mono" style={{ fontSize: 12, color: c.text, letterSpacing: '.08em' }}>
                        {member.toUpperCase()}
                      </span>
                      <span className="mono" style={{ fontSize: 10, color: 'var(--txd)', marginLeft: 4 }}>
                        {items.length} ITEM TYPE{items.length !== 1 ? 'S' : ''}
                      </span>
                    </div>

                    {!items.length ? (
                      <div className="mono" style={{ fontSize: 11, color: 'var(--txd)', paddingLeft: 16 }}>— NO ITEM OBJECTIVES</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {items.map(item => (
                          <div key={`${item.itemId}::${item.foundInRaid}`} style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            background: 'var(--sur2)', border: '1px solid var(--brd)',
                            borderLeft: item.isKey ? `3px solid var(--gold)` : `3px solid var(--brd2)`,
                            borderRadius: 4, padding: '8px 10px',
                          }}>
                            {item.iconLink
                              ? <img src={item.iconLink} alt="" style={{ width: 40, height: 40, objectFit: 'contain', flexShrink: 0, imageRendering: 'pixelated', borderRadius: 3, background: 'var(--sur)', border: '1px solid var(--brd2)' }} />
                              : (
                                <div style={{ minWidth: 28, textAlign: 'center', background: 'var(--sur)', border: '1px solid var(--brd2)', borderRadius: 3, padding: '2px 5px', flexShrink: 0 }}>
                                  <span className="mono" style={{ fontSize: 13, color: 'var(--goldtx)', fontWeight: 700 }}>{item.count}x</span>
                                </div>
                              )
                            }
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                {item.iconLink && (
                                  <span className="mono" style={{ fontSize: 12, color: 'var(--goldtx)', fontWeight: 700 }}>{item.count}x</span>
                                )}
                                <div style={{ fontSize: 13, fontFamily: 'Rajdhani, sans-serif', fontWeight: 600, color: 'var(--tx)', letterSpacing: '.02em' }}>
                                  {item.name}
                                </div>
                                {item.isKey && (
                                  <span className="mono" style={{ fontSize: 9, color: 'var(--goldtx)', background: 'rgba(201,168,76,0.12)', border: '1px solid var(--golddim)', borderRadius: 3, padding: '1px 5px', letterSpacing: '.06em', flexShrink: 0 }}>KEY</span>
                                )}
                              </div>
                              <div style={{ display: 'flex', gap: 6, marginTop: 3, flexWrap: 'wrap', alignItems: 'center' }}>
                                {item.quests.map(q => (
                                  <span key={q} className="mono" style={{
                                    fontSize: 10, color: 'var(--txd)',
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200,
                                  }}>{q}</span>
                                ))}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* Keys */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
          <h3 style={{ fontSize: 18, color: 'var(--goldtx)' }}>PRIORITY KEYS</h3>
          <span className="mono" style={{ fontSize: 10, color: 'var(--txd)' }}>CLICK NAME TO VIEW LOOT ON WIKI</span>
        </div>

        {keysLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
            <Spin />
            <span className="mono" style={{ fontSize: 12, color: 'var(--txm)' }}>LOADING KEYS...</span>
          </div>
        ) : !priorityKeys.length ? (
          <div className="mono" style={{ fontSize: 12, color: 'var(--txd)', padding: '12px 0', textAlign: 'center' }}>
            NO PRIORITY KEYS SET FOR THIS MAP
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {priorityKeys.map(k => {
              const price = k.avg24hPrice || k.lastLowPrice || 0
              return (
                <div key={k.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '7px 10px',
                  background: 'var(--sur2)', border: '1px solid var(--gold)',
                  borderRadius: 4,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {k.wikiLink
                      ? <a href={k.wikiLink} target="_blank" rel="noreferrer"
                          title="Click to view loot details on wiki"
                          style={{ fontSize: 13, color: 'var(--tx)', textDecoration: 'none' }}
                          onMouseEnter={e => e.currentTarget.style.color = 'var(--gold)'}
                          onMouseLeave={e => e.currentTarget.style.color = 'var(--tx)'}>
                          {k.name} <span style={{ fontSize: 10, color: 'var(--txd)' }}>↗</span>
                        </a>
                      : <span style={{ fontSize: 13, color: 'var(--tx)' }}>{k.name}</span>
                    }
                  </div>
                  <div className="mono" style={{
                    fontSize: 12,
                    color: price ? 'var(--goldtx)' : 'var(--txd)',
                    minWidth: 90, textAlign: 'right', whiteSpace: 'nowrap', flexShrink: 0,
                  }}>
                    {price ? `₽${FMT.format(price)}` : '—'}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

    </div>
  )
}
