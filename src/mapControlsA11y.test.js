import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(process.cwd(), 'src', 'components', 'MapLeaflet.jsx'), 'utf8')

describe('MapLeaflet accessibility contract', () => {
  it('exposes state for the high-frequency map mode and layer toggles', () => {
    for (const label of ['DRAW', 'QUEST MARKER', 'PMC SPAWNS', 'QUEST PINS', 'PINGS']) {
      const control = source.slice(source.indexOf(label) - 500, source.indexOf(label) + label.length)
      expect(control, label).toContain('type="button"')
      expect(control, label).toContain('aria-pressed=')
    }
    expect(source).toContain('aria-haspopup="dialog"')
    expect(source).toContain('aria-controls="map-layer-popover"')
    expect(source).toContain('id="map-layer-popover"')
    expect(source).toContain('ref={layersDialogRef}')
  })

  it('keeps ping cards keyboard activatable', () => {
    const cardStart = source.indexOf('className={`ping-card')
    const card = source.slice(cardStart, cardStart + 1800)
    expect(card).toContain('role="button"')
    expect(card).toContain('tabIndex={0}')
    expect(card).toContain("event.key === 'Enter' || event.key === ' '")
    expect(card).toContain('event.preventDefault()')
  })
})
