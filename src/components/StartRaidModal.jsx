import { useEffect, useMemo, useState } from 'react'
import { useBossSpawns, useExtracts, useKeys } from '../useTarkov'
import { normalizeMembers, objectiveProgressKey, prepPackedKey } from '../partyMembers'
import { memberColor } from '../memberColors'
import useDialogFocus from '../useDialogFocus'
import { objectiveIsOnMap, taskIsOnMap } from '../tarkovObjectives'

const EXTRACT_STYLES = {
  GEAR: { color: '#e8c96a', border: 'rgba(201,168,76,.42)', background: 'rgba(201,168,76,.1)', rail: '#c9a84c' },
  PAID: { color: '#e8c96a', border: 'rgba(201,168,76,.42)', background: 'rgba(201,168,76,.1)', rail: '#c9a84c' },
  POWER: { color: '#7ec2f4', border: 'rgba(126,194,244,.4)', background: 'rgba(126,194,244,.1)', rail: '#4b8fb8' },
  'CO-OP': { color: '#cd86f2', border: 'rgba(205,134,242,.4)', background: 'rgba(205,134,242,.1)', rail: '#6a2a90' },
  TIMED: { color: '#d69b5a', border: 'rgba(214,155,90,.4)', background: 'rgba(214,155,90,.1)', rail: '#b6603c' },
}

const ACTION_COLORS = { BRING: '#4b8fb8', KEY: '#c9a84c', FIND: '#e85a5a' }

function getTarkovTimes() {
  const utcSecs = Date.now() / 1000
  const tarkovSecs = (utcSecs * 7) % 86400
  return { left: tarkovSecs, right: (tarkovSecs + 43200) % 86400 }
}

function toHHMM(secs) {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function isDaytime(secs) {
  const h = secs / 3600
  return h >= 6 && h < 21
}

function percentage(value) {
  const pct = Math.round(Number(value) * 100)
  return Number.isFinite(pct) && pct > 0 ? pct : null
}

function upper(value) {
  return String(value || '').toUpperCase()
}

function classifyExtract(extract) {
  const normalized = String(extract?.name || '').toLowerCase()
  const hasSwitch = Array.isArray(extract?.switchIds) && extract.switchIds.length > 0
  if (/co[ -]?op|scav lands|scav camp|friendship bridge|side tunnel|pinewood basement/.test(normalized)) {
    return { tag: 'CO-OP', requirement: 'Needs a friendly player scav to extract — coordinate first', note: 'FREE · NO GEAR' }
  }
  if (/v-ex|taxi/.test(normalized)) {
    return { tag: 'PAID', requirement: 'Vehicle extract — bring roubles for the squad toll', note: 'LIMITED SEATS · MAY DEPART' }
  }
  if (/flare/.test(normalized)) {
    return { tag: 'GEAR', requirement: 'Requires a green flare fired from the signal area', note: 'WAIT FOR THE SIGNAL PROMPT' }
  }
  if (/cliff descent|climber's trail|mountain pass/.test(normalized)) {
    return { tag: 'GEAR', requirement: 'Red Rebel ice pick + paracord in container', note: 'CHECK ARMOUR RESTRICTIONS' }
  }
  if (/sewer manhole|hole in the fence|ventilation shaft/.test(normalized)) {
    return { tag: 'GEAR', requirement: 'Loadout restriction applies — drop your backpack before extracting', note: 'NO BACKPACK' }
  }
  if (/armored train/.test(normalized)) {
    return { tag: 'TIMED', requirement: 'Train arrives and departs during a limited raid window', note: 'LISTEN FOR THE ARRIVAL HORN' }
  }
  if (/old gas station|smugglers' boat|pier boat|courtyard$/.test(normalized)) {
    return { tag: 'TIMED', requirement: 'Only available in some raids — confirm the visual signal', note: 'CHECK ON LOAD-IN' }
  }
  if (hasSwitch) {
    return { tag: 'POWER', requirement: 'Requires a map switch or power control to be activated', note: 'ACTIVATE BEFORE EXTRACT' }
  }
  return null
}

function SectionHeading({ id, number, title, hint, meta }) {
  return (
    <div className="start-raid-section-heading">
      <span className="start-raid-section-number">{number}</span>
      <h2 id={id}>{title}</h2>
      {hint ? <span className="mono start-raid-section-hint">{hint}</span> : null}
      {meta ? <span className="mono start-raid-section-meta">{meta}</span> : null}
    </div>
  )
}

function RaidClock({ seconds }) {
  const day = isDaytime(seconds)
  return (
    <div className={`start-raid-clock ${day ? 'is-day' : 'is-night'}`}>
      <span className="mono start-raid-clock-time">{toHHMM(seconds)}</span>
      <span className="mono start-raid-clock-phase" aria-label={day ? 'Daytime' : 'Nighttime'}>
        <span aria-hidden="true">{day ? '☀' : '☽'}</span> {day ? 'DAY' : 'NIGHT'}
      </span>
    </div>
  )
}

// A row is only tickable by someone the item belongs to: merge_progress stamps
// the caller's uid onto every key, so a tick on a mate's row could never be
// recorded as theirs. Everyone still reads the chips, which is the shared part.
function PrepItem({ item, checked, mine, memberNames, onToggle }) {
  const Row = mine ? 'button' : 'div'
  const interactive = mine ? { type: 'button', role: 'checkbox', 'aria-checked': checked, onClick: onToggle } : {}
  return (
    <Row
      className={`start-raid-prep-row ${checked ? 'is-checked' : ''} ${mine ? '' : 'is-theirs'}`}
      style={{ '--prep-rail': ACTION_COLORS[item.action] || ACTION_COLORS.BRING }}
      {...interactive}
    >
      <span className="start-raid-checkbox" aria-hidden="true">{checked ? '✓' : ''}</span>
      {item.iconLink ? (
        <img className="start-raid-item-icon" src={item.iconLink} alt="" width="30" height="30" />
      ) : (
        <span className="mono start-raid-item-icon start-raid-item-fallback" aria-hidden="true">
          {upper(item.name).replace(/[^A-Z0-9]/g, '').slice(0, 3) || '—'}
        </span>
      )}
      <span className={`mono start-raid-item-action action-${item.action.toLowerCase()}`}>{item.action}</span>
      <span
        className={`mono start-raid-item-count ${item.split ? 'is-split' : ''}`}
        title={item.split ? `${item.count} between the squad — see the split on the right` : undefined}
      >
        {item.count}×
      </span>
      <span className="start-raid-item-copy">
        <span className="start-raid-item-name">{item.name}</span>
        <span className="mono start-raid-item-quests" title={item.quests.join(' · ')}>{item.quests.join(' · ')}</span>
      </span>
      {item.foundInRaid ? <span className="mono start-raid-fir">FIR</span> : null}
      <span className="start-raid-owners">
        {item.owners.map(owner => {
          const palette = memberColor(owner.callsign, memberNames)
          const label = upper(owner.callsign || 'MEMBER')
          const need = item.split ? ` needs ${owner.count}` : ''
          return (
            <span
              key={owner.user_id}
              className={`mono start-raid-owner-chip ${owner.packed ? 'is-packed' : ''}`}
              style={{ '--owner-bg': palette.bg, '--owner-border': palette.border, '--owner-text': palette.text }}
              title={owner.packed ? `${label}${need} — packed` : `${label}${need} — not ticked yet`}
            >
              <span aria-hidden="true">{owner.packed ? '✓ ' : ''}</span>{label}
              {item.split ? <b className="start-raid-owner-count">{owner.count}×</b> : null}
            </span>
          )
        })}
      </span>
    </Row>
  )
}

function ExtractCard({ extract }) {
  const style = EXTRACT_STYLES[extract.tag]
  return (
    <article className="start-raid-extract-card" style={{ '--extract-rail': style.rail }}>
      <div className="start-raid-extract-title-row">
        <h3 title={extract.name}>{extract.name}</h3>
        <span className="mono start-raid-extract-tag" style={{ color: style.color, borderColor: style.border, background: style.background }}>{extract.tag}</span>
      </div>
      <p>{extract.requirement}</p>
      <span className="mono start-raid-extract-note">{extract.note}</span>
    </article>
  )
}

function BriefBoss({ boss }) {
  const name = boss.name || 'UNKNOWN BOSS'
  const pct = percentage(boss.spawnChance)
  const locations = (Array.isArray(boss.spawnLocations) ? boss.spawnLocations : [])
    .map(location => ({ name: location?.name, pct: percentage(location?.chance) }))
    .filter(location => location.name && location.pct != null)
    .slice(0, 3)
  const escorts = (Array.isArray(boss.escorts) ? boss.escorts : [])
    .filter(escort => escort?.name && Number(escort.count) > 0)
    .slice(0, 2)
  const armorClass = Number(boss.armorClass)
  const penFloor = { 2: 20, 3: 25, 4: 30, 5: 35, 6: 45 }[armorClass]
  const totalHealth = Number(boss.health?.total)
  const headHealth = Number(boss.health?.head)
  const drops = (Array.isArray(boss.drops) ? boss.drops : []).filter(drop => drop?.name).slice(0, 6)
  const barColor = pct != null && pct >= 30 ? '#e8c96a' : pct != null && pct >= 15 ? '#d69b5a' : '#9c6fb8'

  return (
    <article className="start-raid-boss">
      <div className="start-raid-boss-title-row">
        {boss.portrait ? (
          <img src={boss.portrait} alt="" width="30" height="30" className="start-raid-boss-portrait" />
        ) : (
          <span className="mono start-raid-boss-portrait start-raid-boss-fallback" aria-hidden="true">{upper(name).slice(0, 3)}</span>
        )}
        <h3>{name}</h3>
        <span className="mono start-raid-boss-chance" style={{ color: barColor }}>{pct == null ? '—' : `${pct}%`}</span>
      </div>
      {pct != null ? <div className="start-raid-boss-bar" aria-label={`${pct}% spawn chance`}><span style={{ width: `${pct}%`, background: barColor }} /></div> : null}
      {locations.map(location => <span key={location.name} className="mono start-raid-boss-location">{upper(location.name)} {location.pct}%</span>)}
      {escorts.length ? <span className="mono start-raid-boss-guards">{escorts.map(escort => `+${Math.round(Number(escort.count))} ${upper(escort.name)}`).join(' · ')}</span> : null}
      {penFloor ? <span className="mono start-raid-boss-counter">CLASS {armorClass} ARMOUR — BRING PEN {penFloor}+</span> : null}
      {(totalHealth > 0 || headHealth > 0) ? (
        <span className="mono start-raid-boss-health">{totalHealth > 0 ? `${totalHealth} HP` : null}{totalHealth > 0 && headHealth > 0 ? ' · ' : null}{headHealth > 0 ? `${headHealth} HEAD` : null}</span>
      ) : null}
      {drops.length ? (
        <details className="start-raid-boss-drops">
          <summary className="mono">▸ TOP DROPS ({drops.length})</summary>
          <div>
            {drops.map((drop, index) => (
              <span key={drop.id || `${drop.name}-${index}`}>
                {drop.iconLink ? <img src={drop.iconLink} alt="" width="22" height="22" /> : null}
                <span>{drop.name}</span>
                {Number.isFinite(Number(drop.prevalence)) ? <b className="mono">{Math.round(Number(drop.prevalence))}%</b> : null}
              </span>
            ))}
          </div>
        </details>
      ) : null}
    </article>
  )
}

export default function StartRaidModal({ party, myUserId, tasks, gameMode, onlineMemberIds = [], presenceReady = false, onSubmitProgress, onClose, onCancel = onClose }) {
  const dialogRef = useDialogFocus(true, onCancel)
  const [times, setTimes] = useState(getTarkovTimes)
  const mapNorm = party.map_norm
  const progress = useMemo(() => party.progress || {}, [party.progress])
  const { getBossesForMap, loading: bossLoading } = useBossSpawns(gameMode)
  const { extracts, loading: extractsLoading } = useExtracts(mapNorm, gameMode)
  const { allKeys } = useKeys(mapNorm, gameMode)

  useEffect(() => {
    const id = setInterval(() => setTimes(getTarkovTimes()), 1000)
    return () => clearInterval(id)
  }, [])

  const memberRows = useMemo(() => normalizeMembers(party.members), [party.members])
  const memberNames = useMemo(() => memberRows.map(member => member.callsign), [memberRows])
  const taskById = useMemo(() => new Map(tasks.map(task => [task.id, task])), [tasks])
  const keyIconMap = useMemo(() => Object.fromEntries(allKeys.map(key => [key.id, key.iconLink || null])), [allKeys])

  const squadPrep = useMemo(() => memberRows.map(member => {
    const items = new Map()
    const seenQuests = new Set()
    const mapQuests = member.quests
      .filter(quest => seenQuests.has(quest.id) ? false : (seenQuests.add(quest.id), true))
      .filter(quest => !progress[`__done__:${quest.id}::${member.user_id}`])
      .map(quest => taskById.get(quest.id))
      .filter(task => task && taskIsOnMap(task, mapNorm))

    member.quests.forEach(quest => {
      const task = taskById.get(quest.id)
      if (!task) return
      task.objectives?.forEach(objective => {
        if (objective.optional || progress[objectiveProgressKey(task.id, objective.id, member.user_id)]) return
        const onMap = objectiveIsOnMap(objective, task, mapNorm)
        if (!onMap) return

        const isPlant = objective.type === 'plantItem' && objective.item
        const isMark = objective.type === 'mark' && objective.markerItem
        const isFind = objective.type === 'findItem' && objective.item
        if (isPlant || isMark || isFind) {
          const item = isMark ? objective.markerItem : objective.item
          const action = isFind ? 'FIND' : 'BRING'
          const key = `${item.id}:${action}`
          const current = items.get(key)
          if (current) {
            current.count += isMark ? 1 : (objective.count || 1)
            current.quests.add(task.name)
          } else {
            items.set(key, { key, name: item.name, iconLink: item.iconLink || null, count: isMark ? 1 : (objective.count || 1), action, foundInRaid: Boolean(isFind && objective.foundInRaid), quests: new Set([task.name]) })
          }
        }

        objective.requiredKeys?.forEach(alternatives => alternatives?.forEach(keyItem => {
          if (!keyItem?.id) return
          const key = `${keyItem.id}:KEY`
          const current = items.get(key)
          if (current) current.quests.add(task.name)
          else items.set(key, { key, name: keyItem.name, iconLink: keyItem.iconLink || keyIconMap[keyItem.id] || null, count: 1, action: 'KEY', foundInRaid: false, quests: new Set([task.name]) })
        }))
      })
    })
    return { ...member, mapQuests, items: [...items.values()] }
  }), [keyIconMap, mapNorm, memberRows, progress, taskById])

  const prepItems = useMemo(() => {
    const items = new Map()
    squadPrep.forEach(member => member.items.forEach(item => {
      const owner = {
        user_id: member.user_id,
        callsign: member.callsign,
        count: item.count,
        packed: Boolean(progress[prepPackedKey(item.key, member.user_id)]),
      }
      const current = items.get(item.key)
      if (current) {
        current.count += item.count
        current.owners.push(owner)
        item.quests.forEach(quest => current.quests.add(quest))
        current.foundInRaid ||= item.foundInRaid
      } else {
        items.set(item.key, { ...item, owners: [owner], quests: new Set(item.quests) })
      }
    }))
    return [...items.values()].map(item => ({
      ...item,
      quests: [...item.quests],
      mine: item.owners.some(owner => owner.user_id === myUserId),
      checked: Boolean(progress[prepPackedKey(item.key, myUserId)]),
      // "14 markers between us" is not an instruction to anybody. Once a row is
      // shared, the row total is only useful next to each person's own share.
      // A key is one key each, so a per-owner count there would be noise.
      split: item.owners.length > 1 && item.action !== 'KEY',
    }))
  }, [myUserId, progress, squadPrep])

  // BRING and KEY are what you load in with; FIND is what you come back with, so
  // only the carry list is a readiness question.
  const carryItems = useMemo(() => prepItems.filter(item => item.action !== 'FIND'), [prepItems])
  const findItems = useMemo(() => prepItems.filter(item => item.action === 'FIND'), [prepItems])

  // Readiness counts one obligation per owner per item, so the bar means the
  // same thing as the squad rail beside it rather than "what this reader ticked".
  const carryTotal = carryItems.reduce((count, item) => count + item.owners.length, 0)
  const carryPacked = carryItems.reduce((count, item) => count + item.owners.filter(owner => owner.packed).length, 0)
  const itemsLeft = carryTotal - carryPacked
  const prepPct = carryTotal ? Math.round((carryPacked / carryTotal) * 100) : 100
  const findPacked = findItems.reduce((count, item) => count + item.owners.filter(owner => owner.packed).length, 0)
  const findTotal = findItems.reduce((count, item) => count + item.owners.length, 0)
  // The heading speaks to the reader, so it leads with the reader's own share.
  const myCarry = carryItems.filter(item => item.mine)
  const myLeft = myCarry.filter(item => !item.checked).length
  const carryMeta = myCarry.length
    ? `${myLeft} LEFT FOR YOU · ${itemsLeft} FOR THE SQUAD`
    : `${itemsLeft} LEFT FOR THE SQUAD`
  const questCount = squadPrep.reduce((count, member) => count + member.mapQuests.length, 0)
  const raidExtracts = useMemo(() => extracts.filter(extract => extract.faction !== 'scav'), [extracts])
  const conditionalExtracts = useMemo(() => raidExtracts.map(extract => ({ ...extract, ...classifyExtract(extract) })).filter(extract => extract.tag), [raidExtracts])
  const isFactory = mapNorm === 'factory'
  const dayBosses = mapNorm ? getBossesForMap(mapNorm) : []
  const nightBosses = isFactory ? getBossesForMap('night-factory') : []
  const bosses = isFactory ? [...dayBosses, ...nightBosses] : dayBosses

  function togglePacked(item) {
    if (!myUserId || !item.mine) return
    const key = prepPackedKey(item.key, myUserId)
    onSubmitProgress?.({ [key]: !progress[key] })
  }

  return (
    <div className="start-raid-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onCancel() }}>
      <div ref={dialogRef} className="start-raid-dialog fade-in" role="dialog" aria-modal="true" aria-labelledby="sr-title" aria-describedby="sr-summary" tabIndex={-1}>
        <header className="start-raid-banner" style={{ backgroundImage: `url('/map-banners/reference/${mapNorm}.webp')` }}>
          <div className="start-raid-banner-scrim" aria-hidden="true" />
          <div className="start-raid-banner-content">
            <div className="start-raid-banner-identity">
              <span className="start-raid-banner-rail" aria-hidden="true" />
              <div>
                <span className="mono start-raid-eyebrow"><span aria-hidden="true">◆</span> INSERTING INTO</span>
                <h1 id="sr-title">{upper(party.map_name || 'Unknown')}</h1>
                <p id="sr-summary" className="mono">{memberRows.length} OPERATOR{memberRows.length === 1 ? '' : 'S'} · {questCount} QUEST{questCount === 1 ? '' : 'S'} ON MAP · {upper(gameMode || 'regular')}</p>
              </div>
            </div>
            <div className="start-raid-banner-actions">
              <RaidClock seconds={times.left} />
              <RaidClock seconds={times.right} />
              <button type="button" className="start-raid-close" aria-label="Close raid brief" onClick={onCancel}>×</button>
            </div>
          </div>
        </header>

        <div className="start-raid-readiness" aria-label={`${carryPacked} of ${carryTotal} items packed by the squad`}>
          <span className="mono">PREP CHECK</span>
          <div className="start-raid-readiness-track" aria-hidden="true"><span style={{ width: `${prepPct}%` }} /></div>
          <strong className="mono">{carryPacked} / {carryTotal} PACKED BY SQUAD</strong>
        </div>

        <div className="start-raid-body">
          <main className="start-raid-main">
            <section aria-labelledby="raid-prep-items-title">
              <SectionHeading id="raid-prep-items-title" number="1" title="QUEST ITEMS TO BRING" hint="TICK IT OFF IN YOUR STASH" meta={carryMeta} />
              {carryItems.length ? (
                <div className="start-raid-prep-list">
                  {carryItems.map(item => (
                    <PrepItem key={item.key} item={item} checked={item.checked} mine={item.mine} memberNames={memberNames} onToggle={() => togglePacked(item)} />
                  ))}
                </div>
              ) : <div className="mono start-raid-empty">NOTHING TO CARRY IN FOR THIS MAP</div>}
            </section>

            <section aria-labelledby="raid-prep-find-title">
              <SectionHeading
                id="raid-prep-find-title"
                number="2"
                title="WHAT TO LOOK OUT FOR"
                hint="PICK IT UP IN THE RAID"
                meta={findTotal ? `${findPacked} / ${findTotal} FOUND` : null}
              />
              {findItems.length ? (
                <div className="start-raid-prep-list">
                  {findItems.map(item => (
                    <PrepItem key={item.key} item={item} checked={item.checked} mine={item.mine} memberNames={memberNames} onToggle={() => togglePacked(item)} />
                  ))}
                </div>
              ) : <div className="mono start-raid-empty">NO QUEST ITEMS TO FIND ON THIS MAP</div>}
            </section>

            <section aria-labelledby="raid-prep-extracts-title">
              <SectionHeading id="raid-prep-extracts-title" number="3" title="EXTRACTS THAT NEED SOMETHING" meta={`${raidExtracts.length} EXTRACTS · ${conditionalExtracts.length} CONDITIONAL`} />
              {extractsLoading ? <div className="mono start-raid-empty">LOADING EXTRACTS…</div> : conditionalExtracts.length ? (
                <div className="start-raid-extract-grid">{conditionalExtracts.map(extract => <ExtractCard key={extract.id} extract={extract} />)}</div>
              ) : <div className="mono start-raid-empty">NO SPECIAL EXTRACT REQUIREMENTS FOUND</div>}
            </section>
          </main>

          <aside className="start-raid-rail">
            <section className="start-raid-rail-card" aria-labelledby="start-raid-squad-title">
              <h2 id="start-raid-squad-title" className="mono start-raid-rail-label">SQUAD · {memberRows.length} OPERATORS</h2>
              <div className="start-raid-squad-list">
                {squadPrep.map(member => {
                  const palette = memberColor(member.callsign, memberNames)
                  const owned = carryItems.filter(item => item.owners.some(owner => owner.user_id === member.user_id))
                  const left = owned.filter(item => !progress[prepPackedKey(item.key, member.user_id)]).length
                  const online = !presenceReady || onlineMemberIds.includes(member.user_id)
                  return (
                    <div className="start-raid-squad-row" key={member.user_id}>
                      <span className="start-raid-squad-color" style={{ background: palette.text }} aria-hidden="true" />
                      <span className="start-raid-squad-copy">
                        <strong className={`mono ${member.user_id === myUserId ? 'is-me' : ''} ${online ? '' : 'is-offline'}`}>{upper(member.callsign || 'Squad member')}{member.user_id === myUserId ? ' · YOU' : ''}</strong>
                        <span className="mono">{member.mapQuests.length} QUEST{member.mapQuests.length === 1 ? '' : 'S'} HERE</span>
                      </span>
                      <span className={`mono start-raid-squad-status ${left === 0 ? 'is-ready' : ''}`}>{left === 0 ? 'READY' : `${left} LEFT`}</span>
                    </div>
                  )
                })}
              </div>
            </section>

            <section className="start-raid-rail-card" aria-labelledby="start-raid-boss-title">
              <div className="start-raid-boss-heading">
                <span className="start-raid-section-number">4</span>
                <h2 id="start-raid-boss-title">BOSS SPAWNS</h2>
                <span className="mono">{bosses.length} BOSS{bosses.length === 1 ? '' : 'ES'} · LIVE ODDS</span>
              </div>
              {bossLoading ? <div className="mono start-raid-empty">LOADING BOSSES…</div> : null}
              {!bossLoading && !bosses.length ? <div className="mono start-raid-empty">NO BOSSES ON THIS MAP</div> : null}
              {!bossLoading && bosses.map((boss, index) => <BriefBoss key={`${boss.normalizedName || boss.name}-${index}`} boss={boss} />)}
            </section>
          </aside>
        </div>

        <footer className="start-raid-footer">
          <span className={`mono start-raid-footer-status ${itemsLeft === 0 ? 'is-ready' : ''}`} role="status">
            {itemsLeft === 0 ? 'EVERYTHING PACKED — SQUAD IS READY' : `${itemsLeft} ITEM${itemsLeft === 1 ? '' : 'S'} NOT PACKED ACROSS THE SQUAD — YOU CAN STILL LOAD IN`}
          </span>
          <button type="button" className="start-raid-back" onClick={onCancel}>BACK</button>
          <button type="button" data-autofocus className="start-raid-go" onClick={onClose}>OK — LET'S GO</button>
        </footer>
      </div>
    </div>
  )
}
