import { createHash } from 'crypto'

export const HEADER_MARKER_OPEN = '<!-- pr-mirror-header -->'

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
export const HEADER_MARKER_CLOSE = '<!-- /pr-mirror-header -->'

/**
 * Header labels for mirrored `pull_request_review` summaries. Single source of
 * truth shared by the inbound mirror (which writes these into the comment body)
 * and the task-context review-todo builder (which reads them back to tell a
 * `changes_requested` review apart from a plain comment / approval / dismissal).
 */
export const REVIEW_HEADER = {
  COMMENTED: '💬 Commented',
  APPROVED: '✅ Approved',
  CHANGES_REQUESTED: '🛑 Requested changes',
  DISMISSED: '📭 Review dismissed',
} as const

/** Resolve a Lumo clerkId → GitHub login (or null). */
type LumoMentionResolver = (clerkId: string) => string | null

/** Resolve a GitHub login → { clerkId, displayName } (or null). */
type GithubMentionResolver = (
  login: string
) => { clerkId: string; displayName: string } | null

const MENTION_CHIP_RE =
  /<span[^>]*data-type="mention"[^>]*data-id="([^"]+)"[^>]*>([^<]*)<\/span>/g
const HEADER_RE = new RegExp(
  `${HEADER_MARKER_OPEN}[\\s\\S]*?${HEADER_MARKER_CLOSE}`,
  'g'
)

export function lumoHtmlToGithubMarkdown(
  html: string,
  resolver: LumoMentionResolver
): string {
  // 1. Strip header marker (we never push our own header back to GH)
  let work = html.replace(HEADER_RE, '')
  // 2. Mention chips → @login or plain name
  work = work.replace(
    MENTION_CHIP_RE,
    (_match, clerkId: string, name: string) => {
      const login = resolver(clerkId)
      return login ? `@${login}` : name
    }
  )
  // 3. Coarse HTML→markdown: strip tags, decode entities
  work = work
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<\/?p[^>]*>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
  return work.trim()
}

const GH_MENTION_RE = /(^|[^a-zA-Z0-9_])@([a-zA-Z0-9-]+)/g

// A CommonMark link reference definition on its own line: `[label]: dest`
// with an optional quoted or parenthesized title. `[^…]:` is a footnote,
// which GitHub does render, so it is left alone.
const LINK_REF_DEF_RE =
  /^ {0,3}\[((?!\^)[^\]\n]+)\]:[ \t]*\S+(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?[ \t]*$/
// A backtick fence's info string can't itself contain a backtick.
const FENCE_OPEN_RE = /^ {0,3}(?:(`{3,})[^`]*|(~{3,}).*)$/
// A closing fence carries no info string.
const FENCE_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/

/**
 * Drop the link reference definitions GitHub never renders — e.g. Vercel's
 * `[vc]: #<base64>` marker opening every deployment comment, which otherwise
 * mirrors in as a wall of base64. A definition whose label the body still
 * uses (`[text][label]`, `[label]`) is kept, so its URL isn't lost; lines
 * inside fenced code blocks are kept too.
 */
// CommonMark label matching: case-insensitive, internal whitespace collapsed.
const normalizeLabel = (label: string) =>
  label.trim().replace(/\s+/g, ' ').toLowerCase()

export function stripLinkReferenceDefinitions(markdown: string): string {
  const lines = markdown.split('\n')
  let fence: string | null = null
  // A definition can't interrupt a paragraph: right after a prose line it is
  // plain text on GitHub, so only a line that opens a new block counts.
  let inParagraph = false
  const defs = new Map<number, string>()
  lines.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '')
    if (fence) {
      const close = FENCE_CLOSE_RE.exec(line)?.[1]
      if (close && close[0] === fence[0] && close.length >= fence.length) {
        fence = null
      }
      return
    }
    const openMatch = FENCE_OPEN_RE.exec(line)
    const open = openMatch?.[1] ?? openMatch?.[2]
    if (open) {
      fence = open
      inParagraph = false
      return
    }
    const label = inParagraph ? undefined : LINK_REF_DEF_RE.exec(line)?.[1]
    if (label) {
      defs.set(i, normalizeLabel(label))
      return
    }
    inParagraph = line.trim() !== ''
  })
  if (defs.size === 0) return markdown

  const rest = lines.filter((_, i) => !defs.has(i)).join('\n')
  const used = new Set(
    Array.from(rest.matchAll(/\[([^\]]+)\]/g), m => normalizeLabel(m[1] ?? ''))
  )
  const isUsed = (label: string) => used.has(label)
  const kept = lines.filter((_, i) => {
    const label = defs.get(i)
    return label === undefined || isUsed(label)
  })
  if (kept.length === lines.length) return markdown
  return kept.join('\n').replace(/^\s*\n/, '')
}

export function githubMarkdownToLumoHtml(
  markdown: string,
  resolver: GithubMentionResolver
): string {
  // Strip any header marker that may have leaked back (defense in depth)
  let work = stripLinkReferenceDefinitions(markdown.replace(HEADER_RE, ''))
  // LUM-921: the body is untrusted GitHub text — escape it BEFORE inserting
  // our own markup, so raw HTML (<img onerror>, <svg onload>) lands as text.
  // Logins are [a-zA-Z0-9-] and `@` survives escaping, so mentions still match.
  work = escapeHtml(work)
  // Replace @login with chip or plain text
  work = work.replace(GH_MENTION_RE, (_m, lead: string, login: string) => {
    const hit = resolver(login)
    if (!hit) return `${lead}@${login}`
    return `${lead}<span data-type="mention" data-id="${escapeHtml(hit.clerkId)}">${escapeHtml(hit.displayName)}</span>`
  })
  // Block-ize: each paragraph (blank-line-separated) becomes <p>...</p>
  const paragraphs = work.split(/\n{2,}/).map(p => p.replace(/\n/g, '<br>'))
  return paragraphs.map(p => `<p>${p}</p>`).join('')
}

/** Build a header marker block. */
export function buildHeader(content: string): string {
  return `${HEADER_MARKER_OPEN}${content}${HEADER_MARKER_CLOSE}`
}

/**
 * Strip the pr-mirror header marker block (and the label inside it) from a
 * stored comment body. Used when surfacing a mirrored review comment as a
 * todo — the file:line / "整体要求改动" prefix is rendered separately, so the
 * header would otherwise be duplicated noise.
 */
export function stripPrMirrorHeader(body: string): string {
  return body.replace(HEADER_RE, '')
}

/** Hash for race-patch placeholder fallback lookup. Normalizes line endings + whitespace. */
export function computeBodyHash(body: string): string {
  const normalized = body
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim()
  return createHash('sha256').update(normalized).digest('hex')
}
