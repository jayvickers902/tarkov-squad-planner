import { useEffect, useRef } from 'react'

// The squad column. Read-only by design: every row here belongs to somebody
// else, and merge_progress rejects a progress key that does not end in the
// caller's uid, so a checkbox on a teammate's objective would fail silently at
// the database. Ticking lives in MyTasksPanel and nowhere else.

function MemberCard({ card, active, onFocusPing, onHoverPing }) {
  const clickable = !!card.pingId
  return (
    <div
      className={`mr-member${active ? ' is-active' : ''}${clickable ? ' is-clickable' : ''}`}
      style={{ borderLeftColor: card.color }}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onMouseEnter={() => clickable && onHoverPing?.(card.pingId)}
      onMouseLeave={() => clickable && onHoverPing?.(null)}
      onClick={() => clickable && onFocusPing?.(card.pingId)}
      onKeyDown={event => {
        if (!clickable || (event.key !== 'Enter' && event.key !== ' ')) return
        event.preventDefault()
        onFocusPing?.(card.pingId)
      }}
    >
      <div className="mr-member-head">
        <span className="mono mr-member-name" style={{ color: card.color }}>{card.name}</span>
        <span className={`mono mr-member-state mr-tone-${card.state.tone}`}>{card.state.label}</span>
        <span className="mono mr-member-age">{card.age}</span>
      </div>
      {card.detail.length > 0 && (
        <div className="mono mr-member-detail">
          {card.detail.map((line, index) => <span key={index}>{line}</span>)}
        </div>
      )}
      {card.rows.length > 0 && (
        <div className="mr-member-rows">
          {card.rows.map(row => (
            <div className="mr-member-row" key={row.key}>
              <span className="mr-member-pip" style={{ background: card.color }} aria-hidden="true" />
              <span className="mr-member-row-label">{row.label}</span>
              {row.dist && <span className="mono mr-member-row-dist">{row.dist}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function RaidRail({
  isMobile,
  mobileHeight = 42,
  onMobileHeight,
  heading = 'SQUAD',
  meta = '',
  cards = [],
  aside = null,
  cta = null,
  emptyLabel = 'NO SQUAD ECHO YET',
  focusPingId = null,
  onFocusPing = () => {},
  onHoverPing = () => {},
  tasksSlot = null,
  bossSlot = null,
}) {
  const dragRef = useRef(null)

  useEffect(() => {
    if (!isMobile || !onMobileHeight) return undefined
    function onMove(event) {
      if (!dragRef.current) return
      const next = ((window.innerHeight - event.clientY) / window.innerHeight) * 100
      onMobileHeight(Math.min(78, Math.max(22, next)))
    }
    function onUp() {
      dragRef.current = null
      document.body.style.removeProperty('user-select')
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.removeProperty('user-select')
    }
  }, [isMobile, onMobileHeight])

  function startDrag(event) {
    if (!isMobile) return
    dragRef.current = { y: event.clientY, height: mobileHeight }
    document.body.style.userSelect = 'none'
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  return (
    <aside className={`mr-squad${isMobile ? ' mr-squad-mobile' : ''}`} style={isMobile ? { height: `${mobileHeight}%` } : undefined}>
      {isMobile && (
        <div
          className="mr-squad-drag"
          onPointerDown={startDrag}
          role="separator"
          tabIndex={0}
          aria-label="Resize squad panel"
          aria-orientation="horizontal"
          aria-valuemin={22}
          aria-valuemax={78}
          aria-valuenow={Math.round(mobileHeight)}
          onKeyDown={event => {
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              onMobileHeight?.(Math.min(78, mobileHeight + 5))
            } else if (event.key === 'ArrowDown') {
              event.preventDefault()
              onMobileHeight?.(Math.max(22, mobileHeight - 5))
            }
          }}
        >
          <span />
        </div>
      )}

      {/* On mobile the rail is a bottom sheet and a floating tasks column would
          collide with it, so the personal list rides in here instead. */}
      {tasksSlot}

      <header className="mr-squad-head">
        <span className="mono mr-squad-heading">{heading}</span>
        <span className="mono mr-squad-meta">{meta}</span>
      </header>

      <div className="mr-squad-body">
        {cards.length === 0 && <div className="mono mr-empty">{emptyLabel}</div>}
        {cards.map(card => (
          <MemberCard
            key={card.userId}
            card={card}
            active={!!card.pingId && focusPingId === card.pingId}
            onFocusPing={onFocusPing}
            onHoverPing={onHoverPing}
          />
        ))}
        {bossSlot}
        {aside && (
          <div className="mr-aside">
            <span className="mono mr-aside-head">{aside.heading}</span>
            <span className="mono mr-aside-body">{aside.body}</span>
          </div>
        )}
      </div>

      {cta && (
        <footer className="mr-squad-foot">
          <button
            type="button"
            className={`mr-cta mr-cta-${cta.tone || 'quiet'}`}
            disabled={cta.disabled}
            onClick={cta.onClick}
          >{cta.label}</button>
        </footer>
      )}
    </aside>
  )
}
