import { useMemo, useState } from 'react'
import { useItemSourcing, useKeys } from '../useTarkov'
import { RED_REBEL_MAPS } from '../constants'
import { normalizeMembers, objectiveProgressKey } from '../partyMembers'
import { memberColor } from '../memberColors'
import { objectiveIsOnMap } from '../tarkovObjectives'
import { ItemSourcingControls, SourceBadge } from './ItemSourcing'

export default function RequiredItems({ tasks, memberQuests = [], mapNorm, progress, gameMode, settings = {}, onSetSetting }) {
  const memberRows = normalizeMembers(memberQuests)
  const members = memberRows.map(member => member.callsign)
  const [activeMember, setActiveMember] = useState('all')
  const { allKeys } = useKeys(mapNorm, gameMode)
  const { sourcing, loading: sourcingLoading } = useItemSourcing(gameMode)

  const keyIdSet = useMemo(() => new Set(allKeys.map(k => k.id)), [allKeys])
  // Lookup map for key iconLink by id — tasks query may return null iconLink, fall back to keys query
  const keyIconMap = useMemo(() => Object.fromEntries(allKeys.map(k => [k.id, k.iconLink || null])), [allKeys])
  // Build per-member item lists from their active quests' objectives
  const memberItems = useMemo(() => {
    return memberRows.map(memberRow => {
      const member = memberRow.callsign
      const seen = new Set()
      const quests = memberRow.quests.filter(q => seen.has(q.id) ? false : (seen.add(q.id), true))
      const itemMap = {}

      quests.forEach(q => {
        const task = tasks.find(t => t.id === q.id)
        if (!task) return
        task.objectives?.forEach(obj => {
          if (obj.optional) return
          if (progress?.[objectiveProgressKey(task.id, obj.id, memberRow.user_id)]) return
          const isOnMap = objectiveIsOnMap(obj, task, mapNorm)
          if (!isOnMap) return

          const isPlant = obj.type === 'plantItem' && obj.item
          const isMark  = obj.type === 'mark' && obj.markerItem
          const isKeyObj = (obj.type === 'findItem' || obj.type === 'giveItem') && obj.item && keyIdSet.has(obj.item.id)

          // Bring-in items: plants, markers, key hand-ins
          if (isPlant || isMark || isKeyObj) {
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
          }

          // Keys required to access/complete this objective — processed for ALL objective types
          // requiredKeys is [[Item]] — each inner array is a set of alternatives for one lock
          if (obj.requiredKeys?.length) {
            obj.requiredKeys.forEach(alternatives => {
              if (!alternatives?.length) return
              alternatives.forEach(keyItem => {
                if (!keyItem?.id) return
                const rk = `${keyItem.id}::required`
                if (itemMap[rk]) {
                  if (!itemMap[rk].quests.includes(q.name)) itemMap[rk].quests.push(q.name)
                } else {
                  itemMap[rk] = {
                    itemId: keyItem.id,
                    name: keyItem.name,
                    // tasks API may return null iconLink for keys — fall back to keys query data
                    iconLink: keyItem.iconLink || keyIconMap[keyItem.id] || null,
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

      return { member, userId: memberRow.user_id, items: Object.values(itemMap) }
    })
  }, [tasks, memberRows, progress, mapNorm, keyIdSet, keyIconMap]) // eslint-disable-line

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
          <span className="mono" style={{ fontSize: 'var(--fs-sm)', color: 'var(--goldtx)', letterSpacing: '.04em' }}>
            CLIFF DESCENT AVAILABLE — BRING RED REBEL ICE PICK + PARACORD
          </span>
        </div>
      )}

      <ItemSourcingControls sourcing={sourcing} settings={settings} gameMode={gameMode} onSetSetting={onSetSetting} />
      {sourcingLoading && <div className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--txd)', marginTop: -10 }}>LOADING SOURCE DATA…</div>}

      {/* Required items */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
          <h3 style={{ fontSize: 18, color: 'var(--goldtx)' }}>REQUIRED ITEMS</h3>
          <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--txd)' }}>ITEMS TO BRING IN FOR ACTIVE QUESTS</span>
        </div>

        {!hasAnyItems ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div className="mono" style={{ fontSize: 'var(--fs-sm)', color: 'var(--txd)', letterSpacing: '.1em' }}>NO ITEM REQUIREMENTS</div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--txd)', marginTop: 8 }}>NO ITEMS NEED TO BE BROUGHT IN FOR ACTIVE QUESTS ON THIS MAP</div>
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
                    padding: '5px 10px', fontSize: 'var(--fs-sm)', borderRadius: 4,
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
                      <span className="mono" style={{ fontSize: 'var(--fs-sm)', color: c.text, letterSpacing: '.08em' }}>
                        {member.toUpperCase()}
                      </span>
                      <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--txd)', marginLeft: 4 }}>
                        {items.length} ITEM TYPE{items.length !== 1 ? 'S' : ''}
                      </span>
                    </div>

                    {!items.length ? (
                      <div className="mono" style={{ fontSize: 'var(--fs-sm)', color: 'var(--txd)', paddingLeft: 16 }}>— NO ITEM OBJECTIVES</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {items.map(item => (
                          <div key={`${item.itemId}::${item.foundInRaid}`} style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            background: 'var(--sur2)', border: '1px solid var(--brd)',
                            borderLeft: item.isKey ? `3px solid var(--gold)` : `3px solid var(--brd)`,
                            borderRadius: 4, padding: '8px 10px',
                          }}>
                            {item.iconLink
                              ? <img src={item.iconLink} alt="" style={{ width: 40, height: 40, objectFit: 'contain', flexShrink: 0, imageRendering: 'pixelated', borderRadius: 3, background: 'var(--sur)', border: '1px solid var(--brd)' }} />
                              : (
                                <div style={{ minWidth: 28, textAlign: 'center', background: 'var(--sur)', border: '1px solid var(--brd)', borderRadius: 3, padding: '2px 5px', flexShrink: 0 }}>
                                  <span className="mono" style={{ fontSize: 13, color: 'var(--goldtx)', fontWeight: 700 }}>{item.count}x</span>
                                </div>
                              )
                            }
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                {item.iconLink && (
                                  <span className="mono" style={{ fontSize: 'var(--fs-sm)', color: 'var(--goldtx)', fontWeight: 700 }}>{item.count}x</span>
                                )}
                                <div style={{ fontSize: 13, fontFamily: 'Rajdhani, sans-serif', fontWeight: 600, color: 'var(--tx)', letterSpacing: '.02em' }}>
                                  {item.name}
                                </div>
                                {item.isKey && (
                                  <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--goldtx)', background: 'rgba(201,168,76,0.12)', border: '1px solid var(--golddim)', borderRadius: 3, padding: '1px 5px', letterSpacing: '.06em', flexShrink: 0 }}>KEY</span>
                                )}
                                {item.foundInRaid && (
                                  <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: '#e85a5a', background: 'rgba(232,90,90,0.10)', border: '1px solid rgba(232,90,90,0.3)', borderRadius: 3, padding: '1px 5px', letterSpacing: '.06em', flexShrink: 0 }}>FIR</span>
                                )}
                              </div>
                                <div style={{ display: 'flex', gap: 6, marginTop: 3, flexWrap: 'wrap', alignItems: 'center' }}>
                                  {item.quests.map(q => (
                                  <span key={q} className="mono" style={{
                                    fontSize: 'var(--fs-xs)', color: 'var(--txd)',
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200,
                                  }}>{q}</span>
                                  ))}
                                  {!item.foundInRaid && sourcing[item.itemId] && <SourceBadge entry={sourcing[item.itemId]} settings={settings} gameMode={gameMode} compact />}
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

    </div>
  )
}
