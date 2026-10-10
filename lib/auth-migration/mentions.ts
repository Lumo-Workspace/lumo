/**
 * LUM-1072 — rewrite the user id inside rich-text @mentions (rekey, RFC
 * LUM-1069 §7). Matches mention elements exactly the way
 * lib/editor/parse-mentions.ts reads them: a <span>/<a> whose class contains
 * "mention", type from data-mention-type (missing = 'user'). Only user
 * mentions change; task/sprint/project mentions and all other text are left
 * byte-for-byte alone. Pure.
 */
const MENTION_TAG = /<(?:span|a)\b[^>]*\bclass="[^"]*\bmention\b[^"]*"[^>]*>/g

export function rewriteUserMentions(
  html: string,
  idMap: ReadonlyMap<string, string>
): { html: string; replaced: number } {
  let replaced = 0
  const out = html.replace(MENTION_TAG, tag => {
    const type = /data-mention-type="([^"]+)"/.exec(tag)?.[1] ?? 'user'
    if (type !== 'user') return tag
    return tag.replace(/(\bdata-id=")([^"]+)(")/, (whole, pre, id, post) => {
      const next = idMap.get(id as string)
      if (next === undefined) return whole
      replaced++
      return `${pre}${next}${post}`
    })
  })
  return { html: out, replaced }
}
