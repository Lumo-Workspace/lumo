const ALLOWED_TAGS = new Set([
  'p',
  'strong',
  'em',
  'code',
  'ul',
  'ol',
  'li',
  'input',
  'br',
])

/** Strip all HTML tags except the allowed set. Removes all attributes except type/checked on input. */
export function sanitizeHtml(html: string): string {
  return html.replace(
    /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*\/?>/g,
    (match, tag: string) => {
      const lower = tag.toLowerCase()
      if (!ALLOWED_TAGS.has(lower)) return ''
      // For input, only allow type="checkbox" and checked
      if (lower === 'input') return '<input type="checkbox">'
      // For closing tags, return as-is
      if (match.startsWith('</')) return `</${lower}>`
      // For opening tags, strip all attributes
      if (match.endsWith('/>')) return `<${lower} />`
      return `<${lower}>`
    }
  )
}
