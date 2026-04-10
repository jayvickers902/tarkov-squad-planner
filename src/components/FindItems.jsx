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

export default function FindItems({ tasks, memberQuests, mapNorm, progress, myName }) {
  const members = Object.keys(memberQuests)
  const [activeMember, setActiveMember] = useState('all')

  // Build per-member find-item lists from their active quests' objectives
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
          if (obj.type !== 'findItem' || !obj.item) return
          if (!objIsOnMap(obj, mapNorm, task.map?.normalizedName)) return

          const key = `${obj.item.id}::${obj.foundInRaid ? 'fir' : 'nonfir'}`
          if (itemMap[key]) {
            itemMap[key].count += obj.count || 1
            if (!itemMap[key].quests.includes(q.name)) itemMap[key].quests.push(q.name)
          } else {
            itemMap[key] = {
              itemId: obj.item.id,
              name: obj.item.name,
              iconLink: obj.item.iconLink || null,
              count: obj.count || 1,
              foundInRaid: obj.foundInRaid || false,
              quests: [q.name],
            }
          }
        })
      })

      return { member, items: Object.values(itemMap).sort((a, b) => (b.foundInRaid ? 1 : 0) - (a.foundInRaid ? 1 : 0)) }
    })
  }, [tasks, memberQuests, progress, mapNorm]) // eslint-disable-line

  // Build a cross-party view: group by item, show which members need it
  const sharedItems = useMemo(() => {
    const map = {}
    memberItems.forEach(({ member, items }) => {
      items.forEach(item => {
        const key = `${item.itemId}::${item.foundInRaid ? 'fir' : 'nonfir'}`
        if (map[key]) {
          map[key].members.push({ name: member, count: item.count, quests: item.quests })
        } else {
          map[key] = {
            itemId: item.itemId,
            name: item.name,
            iconLink: item.iconLink,
            foundInRaid: item.foundInRaid,
            members: [{ name: member, count: item.count, quests: item.quests }],
          }
        }
      })
    })
    return Object.values(map).sort((a, b) => {
      // shared items first, then FIR, then alpha
      const sharedDiff = b.members.length - a.members.length
      if (sharedDiff !== 0) return sharedDiff
      if (b.foundInRaid !== a.foundInRaid) return b.foundInRaid ? 1 : -1
      return a.name.localeCompare(b.name)
    })
  }, [memberItems])

  const hasAnyItems = memberItems.some(m => m.items.length > 0)

  const visible = activeMember === 'all'
    ? memberItems
    : memberItems.filter(m => m.member === activeMember)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Shared items callout */}
      {members.length > 1 && sharedItems.filter(i => i.members.length > 1).length > 0 && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <h3 style={{ fontSize: 18, color: 'var(--goldtx)' }}>SHARED FINDS</h3>
            <span className="mono" style={{ fontSize: 10, color: 'var(--txd)' }}>MULTIPLE SQUAD MEMBERS NEED THESE</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {sharedItems.filter(i => i.members.length > 1).map(item => (
              <div key={`${item.itemId}::${item.foundInRaid}`} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                background: 'rgba(201,168,76,0.05)',
                border: '1px solid var(--golddim)',
                borderLeft: `3px solid var(--gold)`,
                borderRadius: 4, padding: '8px 10px',
              }}>
                {item.iconLink && (
                  <img src={item.iconLink} alt="" style={{ width: 40, height: 40, objectFit: 'contain', flexShrink: 0, imageRendering: 'pixelated', borderRadius: 3, background: 'var(--sur)', border: '1px solid var(--brd2)' }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontFamily: 'Rajdhani, sans-serif', fontWeight: 600, color: 'var(--tx)', letterSpacing: '.02em' }}>
                      {item.name}
                    </span>
                    {item.foundInRaid && (
                      <span className="mono" style={{
                        fontSize: 9, color: 'var(--gold)', background: 'rgba(229,173,0,.12)',
                        border: '1px solid var(--golddim)', borderRadius: 2, padding: '1px 5px', letterSpacing: '.06em',
                      }}>FIR</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                    {item.members.map(({ name, count, quests }) => {
                      const c = memberColor(name, members)
                      return (
                        <span key={name} className="mono" style={{
                          fontSize: 10, padding: '1px 6px', borderRadius: 3,
                          background: c.bg, border: `1px solid ${c.border}`, color: c.text,
                        }} title={quests.join(', ')}>
                          {name.slice(0, 10).toUpperCase()} × {count}
                        </span>
                      )
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-member find lists */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
          <h3 style={{ fontSize: 18, color: 'var(--goldtx)' }}>ITEMS TO FIND</h3>
          <span className="mono" style={{ fontSize: 10, color: 'var(--txd)' }}>COLLECT THESE DURING RAID FOR ACTIVE QUESTS</span>
        </div>

        {!hasAnyItems ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div className="mono" style={{ fontSize: 12, color: 'var(--txd)', letterSpacing: '.1em' }}>NO FIND OBJECTIVES</div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--txd)', marginTop: 8 }}>NO ITEMS NEED TO BE FOUND IN RAID FOR ACTIVE QUESTS ON THIS MAP</div>
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
                const isMe = member === myName
                return (
                  <div key={member}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${c.border}`,
                    }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: c.text, flexShrink: 0 }} />
                      <span className="mono" style={{ fontSize: 12, color: c.text, letterSpacing: '.08em' }}>
                        {member.toUpperCase()}{isMe ? ' (YOU)' : ''}
                      </span>
                      <span className="mono" style={{ fontSize: 10, color: 'var(--txd)', marginLeft: 4 }}>
                        {items.length} ITEM TYPE{items.length !== 1 ? 'S' : ''}
                      </span>
                    </div>

                    {!items.length ? (
                      <div className="mono" style={{ fontSize: 11, color: 'var(--txd)', paddingLeft: 16 }}>— NO FIND OBJECTIVES</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {items.map(item => {
                          // check if other members also need this
                          const others = memberItems
                            .filter(m => m.member !== member)
                            .filter(m => m.items.some(i => i.itemId === item.itemId && i.foundInRaid === item.foundInRaid))
                            .map(m => m.member)
                          return (
                            <div key={`${item.itemId}::${item.foundInRaid}`} style={{
                              display: 'flex', alignItems: 'center', gap: 10,
                              background: 'var(--sur2)', border: '1px solid var(--brd)',
                              borderLeft: `3px solid ${item.foundInRaid ? 'var(--gold)' : 'var(--brd2)'}`,
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
                                  {others.length > 0 && (
                                    <span className="mono" style={{ fontSize: 9, color: 'var(--goldtx)', letterSpacing: '.04em' }}>
                                      also: {others.map(o => o.toUpperCase()).join(', ')}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          )
                        })}
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
