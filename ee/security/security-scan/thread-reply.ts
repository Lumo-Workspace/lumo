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

/**
 * A negator: "not", "never", or a contraction ("isn't", "wasn't", "aren't",
 * "doesn't", "didn't", …), optionally softened ("not really"). The `n't`
 * form has no word boundary before it — `\bn't` never matched "isn't", so
 * "This isn't intentional because …" passed as a learning (LUM-1139). Curly
 * apostrophes are folded to `'` before any pattern runs (`foldApostrophes`).
 */
const NEGATOR =
  "(?:\\bnot|n't|\\bnever)(?:\\s+(?:really|actually|entirely|exactly|quite|necessarily|at all))?"

/** Up to two words between the negator and the positive word ("wasn't done on purpose"). */
const FILLER = '(?:\\s+[a-z]+){0,2}?'

/**
 * Negations that flip a positive word ("not intentional", "isn't by design",
 * "wasn't done on purpose", "unintentional").
 */
const NEGATED = [
  new RegExp(`${NEGATOR}${FILLER}\\s*intentional`, 'i'),
  /\bunintentional/i,
  /\bunintended\b/i,
  new RegExp(
    `${NEGATOR}${FILLER}\\s+(?:by design|on purpose|deliberate(?:ly)?|expected|as intended|intended)\\b`,
    'i'
  ),
  // "This isn't a false positive", "not really a false positive" — the
  // positive phrase itself, negated (LUM-1139 review).
  new RegExp(
    `${NEGATOR}\\s+(?:(?:a|an|really a|actually a)\\s+)?false positive`,
    'i'
  ),
  /不是故意|并非故意|非故意|不是有意|并非有意|不是设计如此|不是误报|并非误报|不算误报/,
]

/** Curly / modifier apostrophes → `'`, so "isn’t" reads like "isn't". */
function foldApostrophes(text: string): string {
  return text.replace(/[\u2018\u2019\u02bc\u2032]/g, "'")
}

/**
 * A plan to change the code — overrides a positive statement ("intentional
 * for now, will fix in a follow-up" is not a learning).
 */
const WILL_CHANGE = [
  /\b(?:will|i'?ll|we'?ll|gonna|going to|let me|should|need to|have to) (?:fix|change|address|update|look|handle|revisit|remove|clean|refactor)/i,
  /\b(?:fixing|later|follow[- ]?up|todo|next (?:pr|sprint|release)|eventually|for now|tech debt|temporar(?:y|ily))\b/i,
  // "Fixed" as a report that the code changed — not the adjective ("a fixed
  // internal allowlist", "a fixed set of paths": the LUM-1131 prod probe on
  // PR 1457, where the bare word vetoed two genuine learnings).
  /(?:^|[.!;:,]\s*)fixed\b/i,
  /\bfixed (?:in|by|it|this|that|now|with|via|on|upstream)\b/i,
  /\b(?:already|just|been|was|were|is now|got|i|we|i'?ve|we'?ve) fixed\b/i,
  /\bfixed\s*[.!]?\s*$/i,
  /稍后|以后|后续|回头|待办|已修复|修好了|暂时/,
]

/** Agreement / acknowledgement — a DEFER on its own, never against a positive. */
const ACKNOWLEDGE = [
  /\b(?:good|nice|great) catch\b/i,
  /\b(?:addressed|done|resolved|agreed?|you'?re right|lgtm)\b/i,
  /同意/,
]

/**
 * Asks Lumo to act, or speaks as a system / role — never a learning.
 *
 * `allowlist` / `whitelist` count only as a verb aimed at the finding
 * ("allowlist this", "add it to the allowlist"): as a noun they are how
 * people explain why code is safe ("the dir only comes from a fixed internal
 * allowlist") — LUM-1131 prod probe on PR 1457, where the bare word blocked
 * two genuine learnings before the model was ever asked.
 */
const ACTION_REQUEST = [
  /\b(?:approve|merge|dismiss|disposition|suppress all|mark (?:all|every|this|it|them)\b)/i,
  /\b(?:white|allow)[- ]?list\s+(?:this|it|them|these|those|all|every|the (?:finding|rule|check|warning|alert|issue|file|path)s?)\b/i,
  /\badd (?:this|it|them|that|these|those|the (?:finding|rule|check|warning|alert|issue|file|path)s?) to (?:the |an? |your |lumo'?s? )?(?:white|allow)[- ]?list\b/i,
  /\b(?:ignore|disregard|forget) (?:all |any |the )?(?:previous|prior|above|earlier)\b/i,
  /\b(?:system|assistant|developer)\s*:/i,
  /\byou are now\b|\badmin mode\b|\bjailbreak\b/i,
  /忽略(?:之前|以上|前面)|批准|合并这个/,
]

const anyOf = (patterns: RegExp[], text: string): boolean =>
  patterns.some(p => p.test(text))

/**
 * The reply's sentences that are statements, not questions. URLs and code
 * spans are dropped first, so a `?` in `https://x?a=1` or `user?.id` does
 * not turn a statement into a question.
 */
function statementsOf(text: string): { statements: string; asked: boolean } {
  const plain = text.replace(/\bhttps?:\/\/\S+/gi, ' ').replace(/`[^`]*`/g, ' ')
  const sentences = plain.match(/[^.!?。！？\n]+[.!?。！？]*/g) ?? []
  const statements: string[] = []
  let asked = false
  for (const s of sentences) {
    if (/[?？]\s*$/.test(s.trim())) asked = true
    else statements.push(s)
  }
  return { statements: statements.join(' '), asked }
}

/**
 * The deterministic half of the classifier. `LEARNING` here only means "may
 * be a learning": the model must agree as well (`decideLearning`).
 *
 * The positive evidence must sit in a statement — "Is this intentional?" is
 * a question, not evidence — while a negation or a plan to change the code
 * anywhere in the reply still vetoes it. Agreement words ("done", "good
 * catch") only label a reply that has no positive statement.
 */
export function screenReply(raw: string): ReplyLabel {
  return screenReplyDetailed(raw).label
}

/**
 * Why the gate labelled a reply as it did — logged (never the reply text)
 * when a reply does not become a learning, so a wrongly rejected one can be
 * traced to the rule that rejected it.
 */
export type ScreenReason =
  | 'empty'
  | 'injection_signal'
  | 'action_request'
  | 'too_short'
  | 'too_long'
  | 'no_positive_statement'
  | 'negated'
  | 'will_change'
  | 'positive'

export function screenReplyDetailed(raw: string): {
  label: ReplyLabel
  reason: ScreenReason
} {
  const text = foldApostrophes(raw.trim())
  if (!text) return { label: 'OTHER', reason: 'empty' }
  if (detectInjectionSignals(raw).signals.length > 0)
    return { label: 'BLOCKED', reason: 'injection_signal' }
  if (anyOf(ACTION_REQUEST, text))
    return { label: 'BLOCKED', reason: 'action_request' }
  const { statements, asked } = statementsOf(text)
  const willChange = anyOf(WILL_CHANGE, text)
  const reason: ScreenReason =
    text.length < MIN_LEARNING_CHARS
      ? 'too_short'
      : text.length > MAX_REPLY_CHARS
        ? 'too_long'
        : !anyOf(POSITIVE, statements)
          ? 'no_positive_statement'
          : anyOf(NEGATED, text)
            ? 'negated'
            : willChange
              ? 'will_change'
              : 'positive'
  if (reason === 'positive') return { label: 'LEARNING', reason }
  if (asked) return { label: 'QUESTION', reason }
  if (willChange || anyOf(ACKNOWLEDGE, text)) return { label: 'DEFER', reason }
  return { label: 'OTHER', reason }
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
    // Backticks only: `_` / `*` are part of identifiers and globs
    // (user_id, scripts/**) and must survive.
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    // A leading heading / quote marker would restyle the echoed line.
    .replace(/^[#>\s]+/, '')
  if (t.length > LEARNING_MAX_CHARS)
    t = `${t.slice(0, LEARNING_MAX_CHARS - 1).trimEnd()}…`
  if (t.length < MIN_LEARNING_CHARS) return null
  if (detectInjectionSignals(t).signals.length > 0) return null
  if (anyOf(ACTION_REQUEST, t)) return null
  return t
}

/**
 * The learning's path scope. The model may propose a glob; it is kept only
 * when it is a plain relative glob anchored in a literal top-level directory
 * (`scripts/**`, never `**\/*.ts` / `*.ts`, which reach the whole
 * repository) that still covers the finding's own file — a learning never
 * reaches beyond what the human was looking at. Else the finding's
 * directory, or the file itself for a top-level file. Never repo-wide.
 */
export function normalizePathGlob(
  proposed: string | null | undefined,
  filePath: string
): string {
  const p = (proposed ?? '').trim()
  const segments = p.split('/')
  if (
    p &&
    p.length <= 200 &&
    /^[A-Za-z0-9_.\-/*]+$/.test(p) &&
    !p.startsWith('/') &&
    !segments.includes('..') &&
    !segments.includes('.') &&
    segments.length >= 2 &&
    !segments[0]!.includes('*') &&
    matchPathGlob(p, [filePath])
  )
    return p
  return filePath.includes('/')
    ? `${filePath.slice(0, filePath.lastIndexOf('/'))}/**`
    : filePath
}

/**
 * Final decision: the gate said LEARNING and the model, reading the same
 * reply, agreed and produced a usable sentence.
 */
export function decideLearning(
  gate: ReplyLabel,
  model: { isLearning: boolean; learning: string } | null
): string | null {
  return decideLearningDetailed(gate, model).learning
}

/** Why no learning came out of the model step (logged, like `ScreenReason`). */
export type DecideReason =
  | 'gate'
  | 'model_unavailable'
  | 'model_refused'
  | 'learning_text_rejected'
  | 'learning'

export function decideLearningDetailed(
  gate: ReplyLabel,
  model: { isLearning: boolean; learning: string } | null
): { learning: string | null; reason: DecideReason } {
  if (gate !== 'LEARNING') return { learning: null, reason: 'gate' }
  if (!model) return { learning: null, reason: 'model_unavailable' }
  if (!model.isLearning) return { learning: null, reason: 'model_refused' }
  const learning = cleanLearningText(model.learning)
  return learning
    ? { learning, reason: 'learning' }
    : { learning: null, reason: 'learning_text_rejected' }
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
  /** Whether the learning was stored as a memory, and if not why. */
  stored: 'stored' | 'no_project' | 'failed'
  /** The GitHub thread was really resolved (else the reply says so). */
  closed: boolean
  /** A gate-blocking finding: the reply must say it still blocks. */
  blockingFindingId: string | null
}

/** The reply's first line — never claims a close that did not happen. */
function headLine(login: string, closed: boolean): string {
  return closed
    ? `Thanks @${login} — noted, and this thread is closed for this PR.`
    : `Thanks @${login} — noted. Lumo could not resolve this thread on GitHub; resolve it by hand if you are done with it.`
}

function blockingNote(findingId: string): string {
  return `\n\n⚠️ This finding still blocks moving the task to DONE — a thread reply never clears a blocking finding. The user rules on it with \`lumo finding disposition ${findingId} --false-positive\` (or \`--accepted-risk\`) or in the Lumo web panel.`
}

export function buildLearningReply(input: LearningReplyInput): string {
  const scope = input.pathGlob
    ? `\`${input.repo}\`, files matching \`${input.pathGlob}\``
    : `\`${input.repo}\``
  const head = headLine(input.login, input.closed)
  const body =
    input.stored === 'stored'
      ? `\n\n**${LEARNING_ADDED}** ${input.learning}\n\n_Scope: ${scope}. Lumo's AI review applies it to this pull request until it merges, then to every pull request in the repository. To change or undo it, edit or delete this learning in the project's memory in Lumo._`
      : input.stored === 'no_project'
        ? `\n\nLumo could not store a learning from it: this repository is not linked to a Lumo project.`
        : `\n\nLumo could not store a learning from it this time — nothing was saved.`
  return `${head}${body}${input.blockingFindingId ? blockingNote(input.blockingFindingId) : ''}\n\n${REPLY_NOTE_MARKER}`
}

/**
 * "Intentional" about a finding no learning can change: learnings shape the
 * AI review only, not the scanners or the exploit-path hunt.
 */
export function buildScannerReply(input: {
  login: string
  closed: boolean
  blockingFindingId: string | null
}): string {
  return `${headLine(input.login, input.closed)} Learnings only shape Lumo's AI review, and this finding comes from another scan layer: to rule it out, use \`lumo finding disposition\` or the Lumo web panel — the ruling carries over to later pushes of this PR.${input.blockingFindingId ? blockingNote(input.blockingFindingId) : ''}\n\n${REPLY_NOTE_MARKER}`
}

export function buildAckReply(label: ReplyLabel, login: string): string {
  const body =
    label === 'DEFER'
      ? `Thanks @${login} — Lumo resolves this thread on its own once a push no longer has the finding.`
      : `Thanks @${login}. Lumo does not discuss findings in threads. If this finding does not apply here, reply with the reason (for example "this is intentional because …") and Lumo will apply it to this pull request's reviews until it merges, then to every pull request in this repository; if it is a real problem, the thread resolves on its own once a push fixes it.`
  return `${body}\n\n${REPLY_NOTE_MARKER}`
}

// ── Applying learnings to a review ───────────────────────────────────────────

/** At most this many learnings go into one review prompt… */
export const REVIEW_LEARNINGS_MAX_ITEMS = 12
/** …and at most this many characters (≈ 1k tokens) — out of a 180k prompt. */
export const REVIEW_LEARNINGS_MAX_CHARS = 4_000

/**
 * Learnings scope (LUM-1131 decision): a learning from a reply on an open
 * PR applies only to that PR's reviews; once the source PR merges (into any
 * branch) it applies to the whole repository. Closed without merging, it
 * stays with that PR. "Merged" is read from the stored promotion OR the
 * source PR's current state, so a missed merge event changes nothing.
 */
export function learningInScope(
  l: { sourcePullRequestId: string | null; repoWideAt: Date | null },
  reviewedPullRequestId: string,
  sourceState: string | undefined
): boolean {
  if (l.repoWideAt) return true
  if (sourceState === 'merged') return true
  return (
    l.sourcePullRequestId !== null &&
    l.sourcePullRequestId === reviewedPullRequestId
  )
}

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
