import { describe, it, expect } from 'vitest'
import {
  makeQuestMarkerTooltip, makeObjectivePinTooltip, makeZoneLabelIcon, makeZoneTooltip,
  makeQuestIcon, makeObjIcon, makePingIcon,
} from './mapMarkerHtml'

// `memberName` traces back to a user-chosen callsign, `questName`/`traderName`
// trace back to trader/task data, and image URLs trace back to upstream asset
// links — none of these are trustworthy by construction, so every builder that
// embeds them into an HTML/SVG string must go through mapHtml.js's sanitizers.
// These tests exercise that boundary directly rather than trusting it by
// inspection.

const SCRIPT_PAYLOAD = '<script>alert(1)</script>'
const QUOTE_BREAKOUT = '"><img src=x onerror=alert(2)>'
const DIV_BREAKOUT = '</div><div class="injected">nope</div>'

describe('makeQuestMarkerTooltip — escaping boundary', () => {
  it('escapes a hostile quest name, member name, and trader name', () => {
    const html = makeQuestMarkerTooltip({
      color: '#e85d5d',
      memberName: `Raider${QUOTE_BREAKOUT}${SCRIPT_PAYLOAD}`,
      questName: `Reserve Op${DIV_BREAKOUT}${SCRIPT_PAYLOAD}`,
      traderName: `Prapor${SCRIPT_PAYLOAD}`,
      traderImage: null,
      objectives: [],
    })

    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('</div><div class="injected">')
    expect(html).toContain('&lt;script&gt;')
    // memberName is uppercased before it is escaped, so match case-insensitively
    expect(html.toLowerCase()).toContain('&quot;&gt;&lt;img')
    expect(html).toContain('&lt;/div&gt;')
  })

  it('escapes a hostile objective description and subject item name', () => {
    const html = makeQuestMarkerTooltip({
      color: '#e85d5d',
      memberName: 'Raider',
      questName: 'Reserve Op',
      traderName: 'Prapor',
      traderImage: null,
      objectives: [{
        type: 'giveItem',
        count: 1,
        description: `Hand over the disk${SCRIPT_PAYLOAD}`,
        item: { name: `Hard Drive${QUOTE_BREAKOUT}`, iconLink: null },
      }],
    })

    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;script&gt;')
  })

  it('drops a hostile trader image URL instead of rendering an <img>', () => {
    const html = makeQuestMarkerTooltip({
      color: '#e85d5d',
      memberName: 'Raider',
      questName: 'Reserve Op',
      traderName: 'Prapor',
      traderImage: 'javascript:alert(1)',
      objectives: [],
    })

    expect(html).not.toContain('<img')
  })

  it('drops a disallowed-host trader image URL instead of rendering an <img>', () => {
    const html = makeQuestMarkerTooltip({
      color: '#e85d5d',
      memberName: 'Raider',
      questName: 'Reserve Op',
      traderName: 'Prapor',
      traderImage: 'https://evil.example.com/x.png',
      objectives: [],
    })

    expect(html).not.toContain('<img')
  })

  it('still renders an <img> for an allowlisted trader image host', () => {
    const html = makeQuestMarkerTooltip({
      color: '#e85d5d',
      memberName: 'Raider',
      questName: 'Reserve Op',
      traderName: 'Prapor',
      traderImage: 'https://assets.tarkov.dev/prapor-portrait.png',
      objectives: [],
    })

    expect(html).toContain('<img src="https://assets.tarkov.dev/prapor-portrait.png"')
  })

  it('falls back to the safe default colour for a hostile colour string', () => {
    const html = makeQuestMarkerTooltip({
      color: 'red;}body{background:url(evil)',
      memberName: 'Raider',
      questName: 'Reserve Op',
      traderName: 'Prapor',
      traderImage: null,
      objectives: [],
    })

    expect(html).toMatch(/color:#9aaa98;font-family:'Rajdhani'/)
  })

  // The text label above went through safeColor from the start; the marker dot
  // on the adjacent line did not, and interpolated the same variable raw. Every
  // caller happens to pass a USER_COLORS hex today, so nothing was exploitable
  // — this pins the boundary rather than a bug that ever fired.
  it('falls back to the safe default colour for the marker dot, not just the label', () => {
    const html = makeQuestMarkerTooltip({
      color: 'red;}body{background:url(evil)',
      memberName: 'Raider',
      questName: 'Reserve Op',
      traderName: 'Prapor',
      traderImage: null,
      objectives: [],
    })

    expect(html).not.toContain('body{background:url(evil)')
    expect(html).toMatch(/background:#9aaa98/)
  })
})

describe('icon builders — colour boundary', () => {
  // makeQuestIcon, makeObjIcon and makePingIcon interpolate the colour into SVG
  // fill/stroke attributes. Same gap, same reasoning as the marker dot above.
  it('keeps a hostile colour out of the SVG fill in every icon builder', () => {
    const hostile = '"><script>alert(1)</script>'
    const icons = [
      makeQuestIcon(hostile, 'R'),
      makeObjIcon({ color: hostile, type: 'visit', memberName: 'Raider' }),
      makePingIcon(hostile, 'R', 0, 1, 1),
    ]

    for (const icon of icons) {
      const html = typeof icon === 'string' ? icon : icon.options.html
      expect(html).not.toContain('<script>')
      expect(html).toContain('#9aaa98')
    }
  })
})

describe('makeObjectivePinTooltip — escaping boundary', () => {
  const basePin = {
    color: '#5de87a',
    memberName: 'Scav',
    questName: 'Reserve Op',
    traderName: 'Prapor',
    traderImage: null,
    itemName: 'Bolts',
    itemIcon: null,
    objAction: 'FIND',
    objDescription: 'Find the bolts',
    foundInRaid: false,
    count: 1,
    requiredKeys: [],
  }

  it('escapes a hostile quest name, member name (via owners), and trader name', () => {
    const html = makeObjectivePinTooltip({
      ...basePin,
      questName: `Reserve Op${DIV_BREAKOUT}${SCRIPT_PAYLOAD}`,
      traderName: `Prapor${SCRIPT_PAYLOAD}`,
      owners: [{ color: '#5de87a', memberName: `Scav${QUOTE_BREAKOUT}${SCRIPT_PAYLOAD}` }],
    })

    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('</div><div class="injected">')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;/div&gt;')
  })

  it('escapes a hostile required-key name and drops a hostile key icon URL', () => {
    const html = makeObjectivePinTooltip({
      ...basePin,
      requiredKeys: [{ name: `Office key${SCRIPT_PAYLOAD}`, iconLink: 'javascript:alert(1)' }],
    })

    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<img')
  })

  it('still renders an <img> for an allowlisted key icon host', () => {
    const html = makeObjectivePinTooltip({
      ...basePin,
      requiredKeys: [{ name: 'Office key', iconLink: 'https://assets.tarkov.dev/office-key.png' }],
    })

    expect(html).toContain('<img src="https://assets.tarkov.dev/office-key.png"')
  })

  it('falls back to the safe default colour for a hostile owner colour string', () => {
    const html = makeObjectivePinTooltip({
      ...basePin,
      owners: [{ color: 'expression(alert(1))', memberName: 'Scav' }],
    })

    expect(html).toMatch(/color:#9aaa98;font-family:'Rajdhani'/)
  })
})

describe('makeZoneLabelIcon / makeZoneTooltip — colour and text boundary', () => {
  it('falls back to the safe colour for a hostile zone label colour', () => {
    const icon = makeZoneLabelIcon('Extract', 'javascript:alert(1)')

    expect(icon.options.html).toContain('--zone-color:#9aaa98')
    expect(icon.options.html).not.toContain('javascript:')
  })

  it('escapes a hostile zone label text and badge', () => {
    const icon = makeZoneLabelIcon(`Extract${SCRIPT_PAYLOAD}`, '#e8a030', `<b>${SCRIPT_PAYLOAD}</b>`)

    expect(icon.options.html).not.toContain('<script>')
    expect(icon.options.html).toContain('&lt;script&gt;')
  })

  it('falls back to the safe colour for a hostile zone tooltip title colour', () => {
    const html = makeZoneTooltip('BTR STOP', 'onmouseover=alert(1)', ['line one'])

    expect(html).toContain('color:#9aaa98;')
  })

  it('escapes hostile tooltip title and line text', () => {
    const html = makeZoneTooltip(`BTR${SCRIPT_PAYLOAD}`, '#e8a030', [`note${DIV_BREAKOUT}`])

    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;/div&gt;')
  })
})
