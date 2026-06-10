export interface CommentCard {
  author: string
  createdAt: Date
  body: string
}

export interface RenderCommentsInput {
  comments: CommentCard[]
  /** LUM-N task identifier (the retrieval command argument, not the cuid). */
  identifier: string
  commentsSummary: string | null
}

const INLINE_THRESHOLD = 3

function formatTimestamp(d: Date): string {
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
}

/**
 * Render the "## Comments" section.
 *
 * Short threads (<= 3 comments) are inlined verbatim — they're cheap and the
 * agent benefits from the full text. Longer threads fall back to the cached
 * `commentsSummary` plus a retrieval command for the full thread.
 */
export function renderCommentsSection(input: RenderCommentsInput): string {
  const { comments, identifier, commentsSummary } = input
  if (comments.length === 0) return ''

  const lines: string[] = ['## Comments', '']

  if (comments.length <= INLINE_THRESHOLD) {
    for (const c of comments) {
      lines.push(`**${c.author}** · ${formatTimestamp(c.createdAt)}`)
      lines.push(c.body)
      lines.push('')
    }
    return lines.join('\n').trimEnd()
  }

  const summary = commentsSummary?.trim()
  if (summary) lines.push(summary)
  lines.push(`  ↳ full text: lumo task comments list ${identifier}`)

  return lines.join('\n').trimEnd()
}
