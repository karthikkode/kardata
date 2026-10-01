// Bounded linear text extraction, not DOM execution. Unterminated ignored
// content stays ignored; attributes/comments never become citation evidence.
function tagEnd(html: string, start: number): number {
  let quote = ''
  for (let at = start + 1; at < html.length; at++) {
    const char = html[at]
    if (quote) { if (char === quote) quote = '' }
    else if (char === '"' || char === "'") quote = char
    else if (char === '>') return at
  }
  return -1
}

export function sourceHtmlText(html: string): string {
  // HTML tag names are ASCII. Unicode folding (for example İ) changes
  // string length and would make closing offsets refer to the wrong bytes.
  const lower = html.replace(/[A-Z]/g, (char) => char.toLowerCase())
  const text: string[] = []
  let cursor = 0
  while (cursor < html.length) {
    const start = html.indexOf('<', cursor)
    if (start === -1) { text.push(html.slice(cursor)); break }
    text.push(html.slice(cursor, start), ' ')
    if (html.startsWith('<!--', start)) {
      const end = html.indexOf('-->', start + 4)
      if (end === -1) break
      cursor = end + 3
      continue
    }
    const end = tagEnd(html, start)
    if (end === -1) break
    const name = /^<\s*([a-z][a-z0-9:-]*)/i.exec(html.slice(start, Math.min(end + 1, start + 100)))?.[1]?.toLowerCase()
    if (name === 'script' || name === 'style') {
      const closing = `</${name}`
      let close = lower.indexOf(closing, end + 1)
      while (close !== -1 && !/[\s/>]/.test(lower[close + closing.length] ?? '')) close = lower.indexOf(closing, close + closing.length)
      if (close === -1) break
      const closeEnd = tagEnd(html, close)
      if (closeEnd === -1) break
      cursor = closeEnd + 1
    } else cursor = end + 1
  }
  return text.join('')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim()
}
