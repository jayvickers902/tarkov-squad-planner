import { describe, expect, it } from 'vitest'
import { escapeHtml, parseSanitizedSvg, safeImageUrl } from './mapHtml'

describe('Leaflet HTML safety', () => {
  it('escapes values from users and upstream APIs', () => {
    expect(escapeHtml(`<img src=x onerror="alert('x')">`))
      .toBe('&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;')
  })

  it('removes executable and external SVG content', () => {
    const svg = parseSanitizedSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)">
        <script>alert(1)</script>
        <foreignObject><div>unsafe</div></foreignObject>
        <style>@import url(https://evil.test/x.css)</style>
        <image href="https://evil.test/pixel" />
        <path id="safe" d="M0 0L1 1" onclick="alert(2)" style="fill:url(https://evil.test/x)" />
        <path id="local" clip-path="url(#clip)" />
      </svg>
    `)

    expect(svg.querySelector('script, foreignObject, style, image')).toBeNull()
    expect(svg.hasAttribute('onload')).toBe(false)
    expect(svg.querySelector('#safe').hasAttribute('onclick')).toBe(false)
    expect(svg.querySelector('#safe').hasAttribute('style')).toBe(false)
    expect(svg.querySelector('#local').getAttribute('clip-path')).toBe('url(#clip)')
  })

  it('keeps only scoped presentation rules needed by the map', () => {
    const svg = parseSanitizedSvg(`<svg xmlns="http://www.w3.org/2000/svg">
      <style>.land { fill: #123; stroke-width: 2 } body { display:none } .bad { fill:url(https://evil.test/x) }</style>
      <path class="land" />
    </svg>`)
    expect(svg.querySelector('style').textContent).toContain('#tsp-sanitized-map-svg .land{fill:#123;stroke-width:2}')
    expect(svg.querySelector('style').textContent).not.toContain('body')
    expect(svg.querySelector('style').textContent).not.toContain('evil.test')
  })

  it('rejects non-SVG markup', () => {
    expect(() => parseSanitizedSvg('<html><body>nope</body></html>')).toThrow('Invalid map SVG')
  })
})

describe('safeImageUrl', () => {
  it('passes http(s) art through and rejects every other scheme', () => {
    expect(safeImageUrl('https://assets.tarkov.dev/x-icon.webp')).toBe('https://assets.tarkov.dev/x-icon.webp')
    expect(safeImageUrl('javascript:alert(1)')).toBe(null)
    expect(safeImageUrl('data:image/svg+xml,<svg onload=alert(1)>')).toBe(null)
    expect(safeImageUrl(null)).toBe(null)
    expect(safeImageUrl('')).toBe(null)
  })
})
