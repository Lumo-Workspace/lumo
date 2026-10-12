const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

const ENTITY_RE = /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi

/**
 * Decode the HTML entities a rich-text editor emits (`&amp; &lt; &gt; &quot;
 * &#39; &nbsp;` plus decimal/hex numeric references) back to plain text.
 * Single pass, so `&amp;lt;` becomes the literal `&lt;`, never `<`. Unknown
 * named entities and out-of-range code points are left as written.
 *
 * The result is plain text: a caller that renders it into a markup format
 * (Slack mrkdwn, HTML) must escape it for that format (LUM-928).
 */
export function decodeHtmlEntities(text: string): string {
  return text.replace(ENTITY_RE, (match, ref: string) => {
    if (ref[0] !== '#') return NAMED_ENTITIES[ref.toLowerCase()] ?? match
    const hex = ref[1] === 'x' || ref[1] === 'X'
    const code = parseInt(ref.slice(hex ? 2 : 1), hex ? 16 : 10)
    if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match
    return code === 0xa0 ? ' ' : String.fromCodePoint(code)
  })
}

/**
 * Strip HTML tags from a string, decode its entities and truncate to `max`
 * characters. Used to build a plain-text preview (e.g. a Slack `commentBody`)
 * from stored HTML. Null/undefined input yields an empty string.
 */
export function htmlToPreview(
  html: string | null | undefined,
  max = 200
): string {
  return decodeHtmlEntities((html ?? '').replace(/<[^>]+>/g, '')).slice(0, max)
}

/** Longest quote text kept from stored HTML (the Slack layer cuts further). */
export const HTML_QUOTE_MAX = 2000

const BLOCK_CLOSE_RE =
  /<\/(?:p|div|li|h[1-6]|blockquote|pre|tr|ul|ol|table)\s*>/gi

/**
 * Turn stored rich-text HTML into plain text that keeps its paragraphs: block
 * ends and `<br>` become newlines, list items get a `• ` bullet, runs of blank
 * lines collapse to one. Cut to `max` characters with a trailing `…` (code
 * points, so emoji are never split). Plain text — escape before rendering.
 */
export function htmlToQuote(
  html: string | null | undefined,
  max = HTML_QUOTE_MAX
): string {
  const text = decodeHtmlEntities(
    (html ?? '')
      .replace(/<\/p>\s*<\/li>/gi, '</li>')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '• ')
      .replace(BLOCK_CLOSE_RE, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const chars = Array.from(text)
  if (chars.length <= max) return text
  return (
    chars
      .slice(0, Math.max(0, max - 1))
      .join('')
      .trimEnd() + '…'
  )
}

const MENTION_TAG_RE =
  /<(?:span|a)\b[^>]*\bclass="[^"]*\bmention\b[^"]*"[^>]*>/g

function mentionsUser(blockHtml: string, clerkId: string): boolean {
  const tags = blockHtml.match(MENTION_TAG_RE) ?? []
  return tags.some(tag => {
    const type = /data-mention-type="([^"]+)"/.exec(tag)?.[1] ?? 'user'
    return type === 'user' && tag.includes(`data-id="${clerkId}"`)
  })
}

/**
 * The text around where `clerkId` is @-mentioned in `html`: the paragraph
 * (or list item / heading) holding the mention, as `htmlToQuote` text. Falls
 * back to the start of the whole document when the mention is not found.
 */
export function mentionContext(
  html: string | null | undefined,
  clerkId: string,
  max = HTML_QUOTE_MAX
): string {
  const source = html ?? ''
  const blocks = source.split(
    /(?<=<\/(?:p|li|h[1-6]|blockquote|pre|td|div)\s*>)/i
  )
  const hit = blocks.find(block => mentionsUser(block, clerkId))
  return htmlToQuote(hit ?? source, max)
}
