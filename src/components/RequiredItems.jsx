import { useMemo, useState } from 'react'

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

export default function RequiredItems({ tasks, memberQuests, mapNorm }) {
  const members = Object.keys(memberQuests)
  const [activeMember, setActiveMember] = useState('all')

  // Build per-member item lists from their active quests' objectives
  const memberItems = useMemo(() => {
    return members.map(member => {
      const quests = memberQuests[member] || []
      const itemMap = {}

      quests.forEach(q => {
        const task = tasks.find(t => t.id === q.id)
        if (!task) return
        task.objectives?.forEach(obj => {
          if (obj.optional || !obj.item) return
          if (obj.type !== 'plantItem') return
          if (!objIsOnMap(obj, mapNorm, task.map?.normalizedName)) return
          const key = `${obj.item.id}::${obj.foundInRaid ? 'fir' : 'nonfir'}`
          if (itemMap[key]) {
            itemMap[key].count += obj.count || 1
            if (!itemMap[key].quests.includes(q.name)) itemMap[key].quests.push(q.name)
          } else {
            itemMap[key] = {
              itemId: obj.item.id,
              name: obj.item.name,
              count: obj.count || 1,
              foundInRaid: obj.foundInRaid || false,
              quests: [q.name],
            }
          }
        })
      })

      return { member, items: Object.values(itemMap) }
    })
  }, [tasks, memberQuests]) // eslint-disable-line

  const hasAnyItems = memberItems.some(m => m.items.length > 0)

  if (!hasAnyItems) {
    return (
      <div style={{ textAlign: 'center', padding: '48px 24px' }}>
        <div className="mono" style={{ fontSize: 12, color: 'var(--txd)', letterSpacing: '.1em' }}>NO ITEM REQUIREMENTS</div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--txd)', marginTop: 8 }}>NO ITEMS NEED TO BE BROUGHT IN FOR ACTIVE QUESTS ON THIS MAP</div>
      </div>
    )
  }

  const visible = activeMember === 'all'
    ? memberItems
    : memberItems.filter(m => m.member === activeMember)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <h3 style={{ fontSize: 18, color: 'var(--goldtx)' }}>REQUIRED ITEMS</h3>
        <span className="mono" style={{ fontSize: 10, color: 'var(--txd)' }}>ITEMS TO BRING IN FOR ACTIVE QUESTS</span>
      </div>

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
              {/* Member header */}
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
                      display: 'flex', alignItems: 'flex-start', gap: 10,
                      background: 'var(--sur2)', border: '1px solid var(--brd)',
                      borderLeft: `3px solid ${item.foundInRaid ? 'var(--gold)' : 'var(--brd2)'}`,
                      borderRadius: 4, padding: '8px 10px',
                    }}>
                      {/* Count badge */}
                      <div style={{
                        minWidth: 28, textAlign: 'center',
                        background: 'var(--sur)', border: '1px solid var(--brd2)',
                        borderRadius: 3, padding: '2px 5px', flexShrink: 0,
                      }}>
                        <span className="mono" style={{ fontSize: 13, color: 'var(--goldtx)', fontWeight: 700 }}>
                          {item.count}x
                        </span>
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontFamily: 'Rajdhani, sans-serif', fontWeight: 600, color: 'var(--tx)', letterSpacing: '.02em' }}>
                          {item.name}
                        </div>
                        <div style={{ display: 'flex', gap: 6, marginTop: 3, flexWrap: 'wrap', alignItems: 'center' }}>
                          {item.foundInRaid && (
                            <span className="mono" style={{
                              fontSize: 9, color: 'var(--gold)', background: 'rgba(229,173,0,.12)',
                              border: '1px solid var(--golddim)', borderRadius: 2, padding: '1px 5px', letterSpacing: '.06em',
                            }}>FIR</span>
                          )}
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
    </div>
  )
}
