/**
 * LUM-1154 — chat on a pull request, the pure half: which comments are
 * questions for Lumo, what context the answer is grounded in, and the text
 * Lumo posts.
 *
 * Three ways to ask:
 *   · a reply in one of Lumo's finding threads that asks something (the
 *     LUM-1131 learning gate runs first and keeps its precedence — only a
 *     reply it does not take as a learning can be a question);
 *   · a review-line comment on the diff that mentions the App's handle;
 *   · a PR conversation comment that mentions the handle and is not one of
 *     the LUM-1129 commands.
 *
 * Every question, diff and file is untrusted: it reaches the model fenced
 * and guarded, the model has no tools, and its answer is only ever posted as
 * a comment. A question can never disposition a finding, resolve a thread,
 * approve, or change anything — an answer is words.
 */
import { detectInjectionSignals } from '@/shared/src/untrusted-content'
import type { ReplyLabel } from '@/ee/security/security-scan/thread-reply'

/** Hidden marker on every chat answer outside a finding thread. */
export const CHAT_ANSWER_MARKER = '<!-- lumo-security:chat-answer -->'

/** At most this many answered questions per pull request… */
export const PR_CHAT_MAX_PER_HOUR = 10
/** …per this window. */
export const PR_CHAT_WINDOW_MS = 60 * 60 * 1000

/** A question longer than this is cut (the rest never reaches the model). */
export const CHAT_QUESTION_MAX_CHARS = 2_000
/** The PR diff the model reads, at most. */
export const CHAT_DIFF_MAX_CHARS = 40_000
/** The focused file's content the model reads, at most. */
export const CHAT_FILE_MAX_CHARS = 12_000
/** Lines of the focused file shown either side of the asked-about line. */
export const CHAT_FILE_RADIUS_LINES = 80
/** The answer Lumo posts, at most. */
export const CHAT_ANSWER_MAX_CHARS = 6_000

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function mentionRe(handle: string, flags = 'i'): RegExp {
  return new RegExp(
    `(?<![A-Za-z0-9-])${escapeRegExp(handle)}(?:\\[bot\\])?(?![A-Za-z0-9-])`,
    flags
  )
}

/**
 * The lines a person wrote themselves: code fences and `>` quotes dropped
 * (a quoted earlier comment, or a mention inside code, is not a question).
 */
function ownLines(body: string): string[] {
  const out: string[] = []
  let fenced = false
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim()
    if (/^(```|~~~)/.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced || line.startsWith('>')) continue
    out.push(raw)
  }
  return out
}

/** Does the comment address Lumo — the handle outside code and quotes? */
export function mentionsHandle(body: string, handle: string): boolean {
  const re = mentionRe(handle)
  return ownLines(body).some(l => re.test(l.replace(/`[^`]*`/g, ' ')))
}

/**
 * The question: the comment without quoted lines and without the handle
 * itself, whitespace-trimmed and capped. Code fences stay — a pasted
 * snippet is part of the question.
 */
export function questionText(body: string, handle: string | null): string {
  const kept = body
    .split(/\r?\n/)
    .filter(l => !l.trim().startsWith('>'))
    .join('\n')
  const text = (handle ? kept.replace(mentionRe(handle, 'gi'), ' ') : kept)
    .replace(/[ \t]+/g, ' ')
    .trim()
    .replace(/^[,:\s]+/, '')
  return text.length > CHAT_QUESTION_MAX_CHARS
    ? text.slice(0, CHAT_QUESTION_MAX_CHARS)
    : text
}

/**
 * A PR conversation comment: a command (LUM-1129 — a line starting with the
 * handle followed by a known command, nothing, or a short unknown word that
 * is most likely a mistyped command and gets the help list), a question for
 * the chat (any other mention), or nothing for Lumo.
 */
export function routeConversationComment(
  body: string,
  handle: string,
  parsed: { command: string | null; text: string } | null
): 'command' | 'chat' | null {
  if (parsed) {
    if (parsed.command !== null || parsed.text === '') return 'command'
    if (
      !/[?？]/.test(parsed.text) &&
      parsed.text.split(' ').length <= 2 &&
      !ASKS.some(re => re.test(parsed.text))
    )
      return 'command'
    return 'chat'
  }
  return mentionsHandle(body, handle) ? 'chat' : null
}

/** Opens like a question or a request for an explanation. */
const ASKS = [
  /^\s*(?:why|how|what|where|when|which|who|whose|explain|elaborate|clarify|describe|suggest|show|help|tell me)\b/i,
  // An auxiliary opens a question only when no negation follows it: "Does
  // not matter here", "Can't happen", "Is never null" are statements.
  /^\s*(?:is|are|was|were|does|do|did|can|could|would|should|will)(?![A-Za-z'’])(?!\s+(?:not|never|no)\b)/i,
  // Chinese: an interrogative or a request at the start, or a closing
  // question particle — not the words anywhere ("什么都没变" is a statement).
  /^\s*(?:为什么|为何|怎么|怎样|如何|什么(?![都也])|哪里|哪个|能否|能不能|请解释|解释一下|说明一下|建议)/,
  /[吗呢]\s*[？?。.]?\s*$/,
]

/**
 * A reply in a Lumo finding thread that Lumo answers rather than
 * acknowledges: the gate read it as a question, or (OTHER) it opens like one
 * or addresses Lumo by its handle. Never a LEARNING (the learning path keeps
 * precedence), never a DEFER (agreement needs no answer), never BLOCKED
 * (instruction-shaped text gets no model call).
 */
export function wantsThreadAnswer(
  body: string,
  label: ReplyLabel,
  handle: string | null
): boolean {
  if (label === 'QUESTION') return true
  if (label !== 'OTHER') return false
  if (!body.trim()) return false
  if (handle && mentionsHandle(body, handle)) return true
  const text = questionText(body, handle)
  return ASKS.some(re => re.test(text))
}

/**
 * Asks Lumo to act rather than to answer — approve, merge, dismiss, resolve,
 * rule on a finding. A question about those ("is it safe to merge?") is
 * still a question; only the imperative / "can you …" form is refused.
 */
const ACTION_ASKS = [
  /^\s*(?:please\s+|pls\s+)?(?:approve|merge|dismiss|resolve|close|suppress|disposition|accept|whitelist|allowlist|mark\s+(?:this|it|them|as))\b/i,
  /\b(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:approve|merge|dismiss|resolve|close|suppress|disposition|accept|whitelist|allowlist|mark)\b/i,
  /^\s*(?:请|帮我|麻烦)?\s*(?:批准|合并|驳回|关闭|标记为误报)(?![后前时的])/,
]

export function asksToAct(question: string): boolean {
  return ACTION_ASKS.some(re => re.test(question))
}

/** Text carrying a prompt-injection signal: never sent to the model. */
export function hasInjectionSignal(text: string): boolean {
  return detectInjectionSignals(text).signals.length > 0
}

// ── Context ─────────────────────────────────────────────────────────────────

/** The unified diff of one file out of a whole-PR diff ('' when absent). */
export function extractFileDiff(diff: string, path: string): string {
  const sections = diff.split(/^(?=diff --git )/m)
  return (
    sections.find(s => {
      const head = s.split('\n', 1)[0] ?? ''
      return head.endsWith(` b/${path}`) || head.includes(` a/${path} `)
    }) ?? ''
  )
}

/**
 * The diff the model reads: the focused file's section first, then the rest
 * of the PR, cut at `max` on a line boundary.
 */
export function packDiff(
  diff: string,
  focusPath: string | null,
  max = CHAT_DIFF_MAX_CHARS
): { text: string; truncated: boolean } {
  const focus = focusPath ? extractFileDiff(diff, focusPath) : ''
  const rest = focus ? diff.replace(focus, '') : diff
  const full = `${focus}${rest}`
  if (full.length <= max) return { text: full, truncated: false }
  const cut = full.slice(0, max)
  const nl = cut.lastIndexOf('\n')
  return { text: nl > 0 ? cut.slice(0, nl + 1) : cut, truncated: true }
}

/**
 * The focused file around the asked-about line, numbered (`  42| code`), so
 * the model can quote line numbers. The whole file when no line is known,
 * capped at `max`.
 */
export function windowLines(
  content: string,
  line: number | null,
  radius = CHAT_FILE_RADIUS_LINES,
  max = CHAT_FILE_MAX_CHARS
): string {
  const lines = content.split('\n')
  const from = line ? Math.max(1, line - radius) : 1
  const to = line ? Math.min(lines.length, line + radius) : lines.length
  const out: string[] = []
  let used = 0
  for (let n = from; n <= to; n++) {
    const row = `${String(n).padStart(5)}| ${lines[n - 1] ?? ''}`
    if (used + row.length + 1 > max) break
    out.push(row)
    used += row.length + 1
  }
  return out.join('\n')
}

// ── Answer ──────────────────────────────────────────────────────────────────

const CONTROL_AND_INVISIBLE = new RegExp(
  '[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069]',
  'g'
)

/** Hosts a link in an answer may point at; any other URL stays plain text. */
const ALLOWED_LINK =
  /^\s*<?https:\/\/(?:[a-z0-9-]+\.)*(?:github\.com|uselumo\.ai)(?=[/?#)>\s]|$)/i

/** Fence languages GitHub renders (diagrams, maps, models) instead of showing. */
const RENDERED_FENCES = new Set([
  'mermaid',
  'geojson',
  'topojson',
  'stl',
  'math',
])

/**
 * Prose (never code): nothing in it may render as an image, a raw HTML tag,
 * a reference definition, or a link to a host outside the allowlist — any
 * of those could make GitHub fetch, or a reader follow, a URL carrying data
 * out. Each is broken with a character entity, which markdown shows as the
 * literal character but never reads as syntax (a backslash would not do: a
 * preceding backslash could escape it). The URL itself stays as plain text.
 */
function neutralizeProse(text: string): string {
  return (
    text
      // `![` — every image form (inline, reference, collapsed, shortcut).
      .replace(/!\[/g, '&#33;[')
      // `]:` — every reference definition, in any container.
      .replace(/\]:/g, ']&#58;')
      // `](` — an inline link, unless it points at an allowlisted host.
      .replace(/\]\(/g, (m, offset: number, whole: string) =>
        ALLOWED_LINK.test(whole.slice(offset + 2, offset + 2 + 300))
          ? m
          : ']&#40;'
      )
      // `<` — every raw HTML tag (img, picture/source srcset, video, …) and
      // autolink; `Map<K, V>` still reads as written.
      .replace(/</g, '&lt;')
      .replace(/@(?=[A-Za-z0-9-])/g, '@⁠')
  )
}

/**
 * Prose with its code spans kept as code: a span opens with a run of N
 * backticks and closes at the next run of exactly N (CommonMark); a run with
 * no partner is literal text. A backslash escapes the next character.
 */
function sanitizeInline(text: string): string {
  let out = ''
  let plain = ''
  let i = 0
  while (i < text.length) {
    const ch = text[i]!
    if (ch === '\\') {
      plain += text.slice(i, i + 2)
      i += 2
      continue
    }
    if (ch !== '`') {
      plain += ch
      i++
      continue
    }
    let j = i
    while (text[j] === '`') j++
    const n = j - i
    let k = j
    let close = -1
    while (k < text.length) {
      if (text[k] !== '`') {
        k++
        continue
      }
      let e = k
      while (text[e] === '`') e++
      if (e - k === n) {
        close = k
        break
      }
      k = e
    }
    if (close < 0) {
      plain += text.slice(i, j)
      i = j
      continue
    }
    out += neutralizeProse(plain) + text.slice(i, close + n)
    plain = ''
    i = close + n
  }
  return out + neutralizeProse(plain)
}

/**
 * The answer's markdown, made inert outside code. A fenced block counts as
 * code only when markdown is sure to read it so — an unindented fence line
 * (a backtick fence's info string has no backtick), closed by a fence of
 * the same character at least as long; anything else is prose and is
 * neutralised. A fence left open at the end is closed, so it can never
 * swallow the footnote and marker posted after the answer.
 */
export function sanitizeAnswerMarkdown(text: string): string {
  const out: string[] = []
  let prose: string[] = []
  let fence: { ch: string; len: number } | null = null
  const flush = () => {
    if (prose.length) out.push(sanitizeInline(prose.join('\n')))
    prose = []
  }
  for (const line of text.split('\n')) {
    if (fence) {
      out.push(line)
      if (
        new RegExp(`^${fence.ch === '`' ? '`' : '~'}{${fence.len},}\\s*$`).test(
          line
        )
      )
        fence = null
      continue
    }
    const m = /^(`{3,}|~{3,})(.*)$/.exec(line)
    if (m && !(m[1]![0] === '`' && m[2]!.includes('`'))) {
      flush()
      fence = { ch: m[1]![0]!, len: m[1]!.length }
      const lang = (m[2] ?? '').trim().split(/\s+/)[0]!.toLowerCase()
      out.push(RENDERED_FENCES.has(lang) ? `${m[1]}text` : line)
      continue
    }
    prose.push(line)
  }
  flush()
  if (fence) out.push(fence.ch.repeat(fence.len))
  return out.join('\n')
}

/**
 * The model's answer, made safe to post: no control / invisible characters,
 * no HTML comments anywhere (nothing can forge a Lumo marker, not even inside
 * code), and outside code nothing that renders as an image, an HTML tag, a
 * reference definition or a link off the allowlist, and no one pinged by an
 * `@mention` (`sanitizeAnswerMarkdown`). Every code fence is closed. Capped.
 * `null` when empty.
 */
export function cleanChatAnswer(raw: string): string | null {
  const text = raw
    .replace(CONTROL_AND_INVISIBLE, '')
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .trim()
  if (!text) return null
  let answer = sanitizeAnswerMarkdown(text)
  if (answer.length > CHAT_ANSWER_MAX_CHARS) {
    // Leave room for a closing fence; re-run so a cut inside a block is closed
    // (already-neutralised text passes through unchanged).
    answer = sanitizeAnswerMarkdown(
      `${answer.slice(0, CHAT_ANSWER_MAX_CHARS - 12).trimEnd()}…`
    )
  }
  return answer
}

const FOOTNOTE =
  "<sub>Lumo's answer, from this pull request's diff and files — it can be wrong. An answer never changes a finding, resolves a thread or approves.</sub>"

function blockingNote(findingId: string): string {
  return `\n\n⚠️ This finding still blocks moving the task to DONE — a reply never clears a blocking finding. The user rules on it with \`lumo finding disposition ${findingId} --false-positive\` (or \`--accepted-risk\`) or in the Lumo web panel.`
}

export function buildChatAnswerBody(input: {
  login: string
  answer: string
  marker: string
  blockingFindingId: string | null
}): string {
  return `@${input.login} ${input.answer}${input.blockingFindingId ? blockingNote(input.blockingFindingId) : ''}\n\n${FOOTNOTE}\n\n${input.marker}`
}

export function buildRateLimitedReply(login: string, marker: string): string {
  return `@${login} Lumo answers at most ${PR_CHAT_MAX_PER_HOUR} questions per pull request per hour — ask again in a little while.\n\n${marker}`
}

export function buildUnavailableReply(login: string, marker: string): string {
  return `@${login} Lumo couldn't answer this time — ask again in a little while.\n\n${marker}`
}

/** A request to act (approve, dismiss, …): Lumo answers questions only. */
export function buildActionRefusalReply(
  login: string,
  handle: string | null,
  marker: string
): string {
  const commands = handle
    ? ` For the reviewer's commands, comment \`${handle} help\` on the pull request.`
    : ''
  return `@${login} Lumo only answers questions here — a comment can't approve, dismiss or rule on a finding. A finding is ruled on with \`lumo finding disposition\` or in the Lumo web panel.${commands}\n\n${marker}`
}
