export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]))
}

const BLOCKED_SVG_ELEMENTS = new Set([
  'script', 'foreignobject', 'iframe', 'object', 'embed', 'audio',
  'video', 'a', 'image', 'use', 'set', 'animate', 'animatemotion',
  'animatetransform',
])

function unsafeCss(value) {
  const withoutLocalFragments = value.replace(/url\s*\(\s*(['"]?)#[a-zA-Z0-9_.:-]+\1\s*\)/g, '')
  return /(?:url\s*\(|expression\s*\(|@import|javascript\s*:|data\s*:)/i.test(withoutLocalFragments)
}

const SAFE_SVG_CSS_PROPERTIES = new Set([
  'display', 'fill', 'fill-opacity', 'opacity', 'stroke', 'stroke-dasharray',
  'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-opacity',
  'stroke-width', 'visibility',
])

function sanitizeStyleElement(element) {
  const rules = []
  for (const match of element.textContent.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(',').map(value => value.trim())
    if (!selectors.length || selectors.some(selector => !/^\.[a-zA-Z_][a-zA-Z0-9_-]*$/.test(selector))) continue
    const declarations = []
    for (const rawDeclaration of match[2].split(';')) {
      const separator = rawDeclaration.indexOf(':')
      if (separator < 1) continue
      const property = rawDeclaration.slice(0, separator).trim().toLowerCase()
      const value = rawDeclaration.slice(separator + 1).trim()
      if (SAFE_SVG_CSS_PROPERTIES.has(property) && value && !unsafeCss(value)) {
        declarations.push(`${property}:${value}`)
      }
    }
    if (declarations.length) {
      rules.push(`${selectors.map(selector => `#tsp-sanitized-map-svg ${selector}`).join(',')}{${declarations.join(';')}}`)
    }
  }
  if (rules.length) element.textContent = rules.join('\n')
  else element.remove()
}

// Converts remote map SVG into an inert DOM subtree without ever assigning the
// fetched markup to innerHTML. Only local fragment references survive.
export function parseSanitizedSvg(markup, targetDocument = document) {
  const parsed = new DOMParser().parseFromString(String(markup ?? ''), 'image/svg+xml')
  if (parsed.querySelector('parsererror') || parsed.documentElement?.localName !== 'svg') {
    throw new Error('Invalid map SVG')
  }

  const elements = [parsed.documentElement, ...parsed.documentElement.querySelectorAll('*')]
  parsed.documentElement.setAttribute('id', 'tsp-sanitized-map-svg')
  for (const element of elements) {
    if (BLOCKED_SVG_ELEMENTS.has(element.localName?.toLowerCase())) {
      element.remove()
      continue
    }
    if (element.localName?.toLowerCase() === 'style') {
      sanitizeStyleElement(element)
      continue
    }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value.trim()
      if (name.startsWith('on')
          || ((name === 'href' || name === 'xlink:href') && !value.startsWith('#'))
          || ((name === 'style' || name === 'filter' || name === 'clip-path' || name === 'mask') && unsafeCss(value))) {
        element.removeAttribute(attribute.name)
      }
    }
  }

  return targetDocument.importNode(parsed.documentElement, true)
}
