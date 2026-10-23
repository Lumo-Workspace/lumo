import { createHash } from 'crypto'
import { Marked } from 'marked'
import { sanitizeRichHtml } from '@/lib/html/sanitize-rich-html'

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
// with an optional quoted or parenthesized title. The label needs a
// non-blank character; `[^…]:` is a footnote, which GitHub does render, so
// it is left alone.
const LINK_REF_DEF_RE =
  /^ {0,3}\[((?!\^)(?=[^\]\n]*[^\]\s])[^\]\n]+)\]:[ \t]*\S+(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?[ \t]*$/
// A backtick fence's info string can't itself contain a backtick.
const FENCE_OPEN_RE = /^ {0,3}(?:(`{3,})[^`]*|(~{3,}).*)$/
// A closing fence carries no info string.
const FENCE_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/
// Single-line blocks (ATX heading, thematic break) that end without starting
// a paragraph, so a definition may follow them directly.
const LEAF_BLOCK_RE =
  /^ {0,3}(?:#{1,6}(?:[ \t]|$)|(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$)/

const SETEXT_EQ_RE = /^ {0,3}=+[ \t]*$/

// CommonMark label matching: case-insensitive, internal whitespace collapsed.
const normalizeLabel = (label: string) =>
  label.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * Drop the link reference definitions GitHub never renders — e.g. Vercel's
 * `[vc]: #<base64>` marker opening every deployment comment, which otherwise
 * mirrors in as a wall of base64. A definition whose label the body still
 * uses (`[text][label]`, `[label]`) is kept, so its URL isn't lost; lines
 * inside fenced code blocks are kept too.
 */
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
    // `===` under a paragraph line turns it into a setext heading, which
    // closes the paragraph just as a `---` underline does.
    const setextUnderline = inParagraph && SETEXT_EQ_RE.test(line)
    inParagraph =
      line.trim() !== '' && !setextUnderline && !LEAF_BLOCK_RE.test(line)
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

// LUM-1305: the few raw-HTML tags GitHub comments lean on that pass through
// as markup — `<details>`/`<summary>` (bot reports fold sections with them)
// and attribute-less inline formatting. Only these exact shapes match; any
// other tag, or one carrying an attribute (`<b onclick>`), stays text.
const ALLOWED_RAW_TAG_RE =
  /<\/?(?:summary|b|strong|i|em|code|sub|sup)\s*>|<details(?:\s+open)?\s*>|<\/details\s*>|<br\s*\/?>/gi
const HTML_COMMENT_RE = /<!--[\s\S]*?(?:-->|$)/g

/**
 * Raw HTML in the markdown, block or inline: GitHub hides comments, so they
 * go; allowlisted tags are kept (lower-cased); everything else is escaped so
 * `<img onerror>` / `<svg onload>` land as visible text (LUM-921).
 */
function renderRawHtml(html: string, block: boolean): string {
  const text = html.replace(HTML_COMMENT_RE, '')
  let out = ''
  let last = 0
  let keptTag = false
  for (const m of text.matchAll(ALLOWED_RAW_TAG_RE)) {
    out += escapeHtml(text.slice(last, m.index))
    out += m[0].toLowerCase().replace(/\s+/g, ' ').replace(/ >$/, '>')
    last = m.index + m[0].length
    keptTag = true
  }
  out += escapeHtml(text.slice(last))
  if (!block) return out
  // A block of only escaped text (a stray `<img …>` line) still reads as a
  // paragraph; next to a kept tag the surrounding whitespace is layout only.
  if (keptTag) return out.trim()
  return out.trim() ? `<p>${out.trim()}</p>` : ''
}

// Built on first use: most importers (task context, review todos) only read
// the header helpers and never render a mirrored comment.
let githubMarked: Marked | undefined
function getGithubMarked(): Marked {
  githubMarked ??= new Marked({
    gfm: true,
    // GitHub comments render a single newline as a line break.
    breaks: true,
    renderer: {
      html: ({ text, block }) => renderRawHtml(text, block ?? false),
    },
  })
  return githubMarked
}

// Text between tags, outside `<pre>`/`<code>`: where a mention may resolve.
const CODE_OR_TAG_RE =
  /(<pre[\s>][\s\S]*?<\/pre>|<code[\s>][\s\S]*?<\/code>|<[^>]*>)/i

function resolveMentions(
  html: string,
  resolver: GithubMentionResolver
): string {
  return html
    .split(CODE_OR_TAG_RE)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(GH_MENTION_RE, (_m, lead: string, login: string) => {
            const hit = resolver(login)
            if (!hit) return `${lead}@${login}`
            return `${lead}<span data-type="mention" data-id="${escapeHtml(hit.clerkId)}">${escapeHtml(hit.displayName)}</span>`
          })
    )
    .join('')
}

/**
 * GitHub-flavoured markdown (an inbound PR comment) → the rich-text HTML a
 * Lumo comment stores: headings, emphasis, lists, tables, code, links and
 * `<details>` render as markup. The body is untrusted (LUM-921): raw HTML is
 * escaped except the allowlist above, and the result goes through the shared
 * rich-text sanitizer, so no handler or `javascript:` URL survives.
 */
export function githubMarkdownToLumoHtml(
  markdown: string,
  resolver: GithubMentionResolver
): string {
  // Strip any header marker that may have leaked back (defense in depth)
  const work = stripLinkReferenceDefinitions(markdown.replace(HEADER_RE, ''))
  const html = getGithubMarked().parse(work, { async: false }) as string
  // marked ends every block with a newline; between tags it is noise.
  const compact = html.replace(/>\n+</g, '><').trim()
  return sanitizeRichHtml(resolveMentions(compact, resolver))
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
