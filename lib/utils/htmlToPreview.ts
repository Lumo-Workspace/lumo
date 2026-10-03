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
