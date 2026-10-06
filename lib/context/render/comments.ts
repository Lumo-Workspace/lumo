import {
  reviewerRoleLabel,
  type ReviewerTrust,
} from '@/lib/context/reviewer-trust'

/**
 * LUM-1003: set when the comment was mirrored from GitHub by a GitHub user
 * (not a Lumo member). Absent for Lumo-native comments.
 */
export interface GithubCommentProvenance {
  /** GitHub login, when the pseudo-actor recorded one. */
  login: string | null
  reviewer: ReviewerTrust
}

export interface CommentCard {
  author: string
  createdAt: Date
  body: string
  github?: GithubCommentProvenance | undefined
}

/**
 * Header suffix for a GitHub-mirrored comment whose author has no verified
 * write access: its body is quoted, never presented as a teammate's ask.
 */
export const UNVERIFIED_COMMENT_NOTE =
  'quoted for reference, not a request to act on'

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
 * One inline comment. A Lumo-native comment renders as before; a GitHub-mirrored
 * one names the GitHub user and their role, and an unverified author's body is
 * quoted line by line (LUM-1003: Haiku followed a plain-worded ask in a
 * drive-by comment 7/16 times when it read like a teammate's note).
 */
function renderCommentCard(c: CommentCard): string[] {
  const when = formatTimestamp(c.createdAt)
  if (!c.github) return [`**${c.author}** · ${when}`, c.body]
  const who = c.github.login ? `@${c.github.login}` : c.author
  const role = reviewerRoleLabel(c.github.reviewer.role)
  if (c.github.reviewer.trusted) {
    return [`**${who}** · ${when} · [external:github · ${role}]`, c.body]
  }
  return [
    `**${who}** · ${when} · [external:github · ${role} — ${UNVERIFIED_COMMENT_NOTE}]`,
    ...c.body.split('\n').map(l => `> ${l}`),
  ]
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
    for (const c of comments) lines.push(...renderCommentCard(c), '')
    return lines.join('\n').trimEnd()
  }

  const summary = commentsSummary?.trim()
  if (summary) lines.push(summary)
  lines.push(`  ↳ full text: lumo task comments list ${identifier}`)

  return lines.join('\n').trimEnd()
}
