/**
 * LUM-1131 — a human reply in one of Lumo's finding threads, the pure half:
 * who may teach Lumo, which replies can become a learning, and the text Lumo
 * answers with.
 *
 * The reply is untrusted text from a public PR. Nothing here acts on it: the
 * only effects a reply can ever have are a short templated answer, closing
 * that one thread on this PR, and (when this gate AND the model agree) a
 * learning the AI review reads as data later. It never touches a finding's
 * disposition — a gate-blocking finding stays blocking until the user rules
 * on it (`lumo finding disposition` or the web panel, LUM-1128).
 *
 * The gate is deliberately conservative (precision over recall): a question,
 * a deferral ("will fix later"), agreement, a negation ("not intentional"),
 * anything instruction-shaped or addressed to Lumo as a command is never a
 * learning. Only an explicit "intentional / by design / not applicable /
 * false positive" statement passes, and the model may still refuse it.
 */
import { detectInjectionSignals } from '@/shared/src/untrusted-content'
import { classifyReviewer } from '@/lib/context/reviewer-trust'
import { matchPathGlob } from '@/lib/policy/path-glob'

export type ReplyLabel =
  /** States the finding is intentional / not applicable — a learning candidate. */
  | 'LEARNING'
  /** Asks something. */
  | 'QUESTION'
  /** Agrees, or will fix it (now or later). */
  | 'DEFER'
  /** Instruction-shaped, or asks Lumo to act (approve, dismiss, …). */
  | 'BLOCKED'
  /** Anything else. */
  | 'OTHER'

/** Shortest reply that can carry a reason. */
const MIN_LEARNING_CHARS = 12
/** A reply longer than this is not a one-line explanation — no learning. */
const MAX_REPLY_CHARS = 2_000

const POSITIVE = [
  /\bintentional(?:ly)?\b/i,
  /\bby design\b/i,
  /\bon purpose\b/i,
  /\bdeliberate(?:ly)?\b/i,
  /\bexpected(?: behaviou?r)?\b/i,
  /\bas intended\b/i,
  /\bnot applicable\b/i,
  /\b(?:does ?n[o']?t|does not|doesn't) apply\b/i,
  /\bfalse positive\b/i,
  /\bnot (?:a|an) (?:real )?(?:bug|issue|problem|vulnerability)\b/i,
  /故意|有意为之|设计如此|按设计|预期行为|不适用|误报/,
]

/** Negations that flip a positive word ("not intentional", "unintentional"). */
const NEGATED = [
  /\b(?:not|n't|never|un)\s*intentional/i,
  /\bunintended\b/i,
  /\bnot (?:by design|on purpose|deliberate|expected|as intended)\b/i,
  /不是故意|并非故意|非故意/,
]

const DEFER = [
  /\b(?:will|i'?ll|we'?ll|gonna|going to|let me|should) (?:fix|change|address|update|look|handle|revisit|remove|clean)/i,
  /\b(?:later|follow[- ]?up|todo|next (?:pr|sprint|release)|eventually|for now|tech debt)\b/i,
  /\b(?:good|nice|great) catch\b/i,
  /\b(?:fixed|addressed|done|resolved|agreed?|you'?re right|lgtm)\b/i,
  /稍后|以后|后续|回头|待办|已修复|修好了|同意/,
]

/** Asks Lumo to act, or speaks as a system / role — never a learning. */
const ACTION_REQUEST = [
  /\b(?:approve|merge|dismiss|disposition|whitelist|allowlist|suppress all|mark (?:all|every|this|it|them)\b)/i,
  /\b(?:ignore|disregard|forget) (?:all |any |the )?(?:previous|prior|above|earlier)\b/i,
  /\b(?:system|assistant|developer)\s*:/i,
  /\byou are now\b|\badmin mode\b|\bjailbreak\b/i,
  /忽略(?:之前|以上|前面)|批准|合并这个/,
]

const anyOf = (patterns: RegExp[], text: string): boolean =>
  patterns.some(p => p.test(text))

/**
 * The deterministic half of the classifier. `LEARNING` here only means "may
 * be a learning": the model must agree as well (`decideLearning`).
 */
export function screenReply(raw: string): ReplyLabel {
  const text = raw.trim()
  if (!text) return 'OTHER'
  if (detectInjectionSignals(text).signals.length > 0) return 'BLOCKED'
  if (anyOf(ACTION_REQUEST, text)) return 'BLOCKED'
  if (text.includes('?') || text.includes('？')) return 'QUESTION'
  if (anyOf(DEFER, text)) return 'DEFER'
  if (
    text.length >= MIN_LEARNING_CHARS &&
    text.length <= MAX_REPLY_CHARS &&
    anyOf(POSITIVE, text) &&
    !anyOf(NEGATED, text)
  )
    return 'LEARNING'
  return 'OTHER'
}

// ── Who may teach Lumo ───────────────────────────────────────────────────────

export interface ReplyAuthor {
  login: string | null
  type: string | null
  /** GitHub `author_association` on the reply. */
  authorAssociation: string | null
  /** The login maps to a member of this Lumo workspace. */
  isWorkspaceMember: boolean
}

/**
 * A bot is never answered (Lumo's own replies arrive as webhooks too). A
 * human is heard only when LUM-1003 trusts them: a workspace member, or the
 * repository's owner / a collaborator. An org MEMBER who maps to nobody is
 * not verified to have write access — ignored, like a drive-by account.
 */
export function canTeach(author: ReplyAuthor): boolean {
  if (!author.login) return false
  if (author.type !== 'User') return false
  if (/\[bot\]$/i.test(author.login)) return false
  return classifyReviewer({
    authorAssociation: author.authorAssociation,
    authorActorType: author.isWorkspaceMember ? 'HUMAN' : null,
  }).trusted
}

// ── Learning text ────────────────────────────────────────────────────────────

export const LEARNING_MAX_CHARS = 280

/**
 * C0 controls, DEL, zero-width and bidi-control characters. Built from a
 * string of escapes so the source never carries the invisible characters.
 */
const CONTROL_AND_INVISIBLE = new RegExp(
  '[\\u0000-\\u001f\\u007f\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069]',
  'g'
)

/**
 * The model's learning sentence, made safe to store, show on GitHub and
 * render into a later prompt: one line, no links / mentions / markup, capped.
 * `null` when nothing usable is left or it reads as an instruction.
 */
export function cleanLearningText(raw: string): string | null {
  let t = raw
    .replace(CONTROL_AND_INVISIBLE, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\bhttps?:\/\/\S+/gi, '')
    .replace(/@(?=[A-Za-z0-9-])/g, '')
    .replace(/[`*_~#>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (t.length > LEARNING_MAX_CHARS)
    t = `${t.slice(0, LEARNING_MAX_CHARS - 1).trimEnd()}…`
  if (t.length < MIN_LEARNING_CHARS) return null
  if (detectInjectionSignals(t).signals.length > 0) return null
  if (anyOf(ACTION_REQUEST, t)) return null
  return t
}

/**
 * The learning's path scope. The model may propose a glob; it is kept only
 * when it is a plain relative glob that still covers the finding's own file
 * (a learning never reaches beyond what the human was looking at). Else the
 * finding's directory, or the whole repository for a top-level file.
 */
export function normalizePathGlob(
  proposed: string | null | undefined,
  filePath: string
): string | null {
  const p = (proposed ?? '').trim()
  if (
    p &&
    p.length <= 200 &&
    /^[A-Za-z0-9_.\-/*]+$/.test(p) &&
    !p.startsWith('/') &&
    !p.split('/').includes('..') &&
    p !== '**' &&
    p !== '*' &&
    p !== '**/*' &&
    matchPathGlob(p, [filePath])
  )
    return p
  const dir = filePath.includes('/')
    ? filePath.slice(0, filePath.lastIndexOf('/'))
    : ''
  return dir ? `${dir}/**` : null
}

/**
 * Final decision: the gate said LEARNING and the model, reading the same
 * reply, agreed and produced a usable sentence.
 */
export function decideLearning(
  gate: ReplyLabel,
  model: { isLearning: boolean; learning: string } | null
): string | null {
  if (gate !== 'LEARNING' || !model?.isLearning) return null
  return cleanLearningText(model.learning)
}

// ── Lumo's answers ───────────────────────────────────────────────────────────

/** Hidden marker on every thread answer — the same one LUM-1127's notes carry. */
export const REPLY_NOTE_MARKER = '<!-- lumo-security:thread-note -->'

/** Body prefix of a learning answer — what the human looks for. */
export const LEARNING_ADDED = 'Learning added:'

export interface LearningReplyInput {
  login: string
  learning: string
  repo: string
  pathGlob: string | null
  /** Stored as a memory (false = no Lumo project for this repository). */
  stored: boolean
  /** A gate-blocking finding: the reply must say it still blocks. */
  blockingFindingId: string | null
}

function blockingNote(findingId: string): string {
  return `\n\n⚠️ This finding still blocks moving the task to DONE — a thread reply never clears a blocking finding. The user rules on it with \`lumo finding disposition ${findingId} --false-positive\` (or \`--accepted-risk\`) or in the Lumo web panel.`
}

export function buildLearningReply(input: LearningReplyInput): string {
  const scope = input.pathGlob
    ? `\`${input.repo}\`, files matching \`${input.pathGlob}\``
    : `\`${input.repo}\``
  const head = `Thanks @${input.login} — noted, and this thread is closed for this PR.`
  const body = input.stored
    ? `\n\n**${LEARNING_ADDED}** ${input.learning}\n\n_Scope: ${scope}. Lumo's AI review applies it to future pull requests here. To change or undo it, edit or delete this learning in the project's memory in Lumo._`
    : `\n\nLumo could not store a learning from it: this repository is not linked to a Lumo project.`
  return `${head}${body}${input.blockingFindingId ? blockingNote(input.blockingFindingId) : ''}\n\n${REPLY_NOTE_MARKER}`
}

/**
 * "Intentional" about a finding no learning can change: learnings shape the
 * AI review only, not the scanners or the exploit-path hunt.
 */
export function buildScannerReply(input: {
  login: string
  blockingFindingId: string | null
}): string {
  return `Thanks @${input.login} — noted, and this thread is closed for this PR. Learnings only shape Lumo's AI review, and this finding comes from another scan layer: to rule it out, use \`lumo finding disposition\` or the Lumo web panel — the ruling carries over to later pushes of this PR.${input.blockingFindingId ? blockingNote(input.blockingFindingId) : ''}\n\n${REPLY_NOTE_MARKER}`
}

export function buildAckReply(label: ReplyLabel, login: string): string {
  const body =
    label === 'DEFER'
      ? `Thanks @${login} — Lumo resolves this thread on its own once a push no longer has the finding.`
      : `Thanks @${login}. Lumo does not discuss findings in threads. If this finding does not apply here, reply with the reason (for example "this is intentional because …") and Lumo will remember it for future reviews of this repository; if it is a real problem, the thread resolves on its own once a push fixes it.`
  return `${body}\n\n${REPLY_NOTE_MARKER}`
}

// ── Applying learnings to a review ───────────────────────────────────────────

/** At most this many learnings go into one review prompt… */
export const REVIEW_LEARNINGS_MAX_ITEMS = 12
/** …and at most this many characters (≈ 1k tokens) — out of a 180k prompt. */
export const REVIEW_LEARNINGS_MAX_CHARS = 4_000

export interface StoredLearning {
  text: string
  pathGlob: string | null
}

/**
 * The learnings relevant to this review — repository-wide ones, and those
 * whose glob matches a file the review reads — newest first, bounded.
 */
export function selectRelevantLearnings(
  learnings: StoredLearning[],
  reviewedPaths: string[]
): StoredLearning[] {
  return learnings
    .filter(
      l => l.pathGlob === null || matchPathGlob(l.pathGlob, reviewedPaths)
    )
    .slice(0, REVIEW_LEARNINGS_MAX_ITEMS)
}

/**
 * One line per learning, every line run through `guard` (the injection
 * guard chain — the caller passes `guardPromptLineText`), capped at
 * `REVIEW_LEARNINGS_MAX_CHARS` on whole lines. `''` when there is nothing.
 */
export function renderReviewLearnings(
  learnings: StoredLearning[],
  guard: (line: string) => string
): string {
  const lines: string[] = []
  let used = 0
  for (const l of learnings) {
    const text = cleanLearningText(l.text)
    if (!text) continue
    const line = `- ${l.pathGlob ? `[${l.pathGlob}] ` : ''}${guard(text)}`
    if (used + line.length + 1 > REVIEW_LEARNINGS_MAX_CHARS) break
    lines.push(line)
    used += line.length + 1
  }
  return lines.join('\n')
}
