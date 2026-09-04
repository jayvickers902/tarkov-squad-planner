/** Return true when a string contains an ASCII control character. */
export function containsAsciiControlCharacter(value) {
  if (typeof value !== 'string') return false
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint <= 0x1f || codePoint === 0x7f) return true
  }
  return false
}
