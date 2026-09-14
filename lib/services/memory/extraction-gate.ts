import type { MemoryCategory } from '@prisma/client'
import { memoryContentToText } from '@/lib/memory/content-text'
import { bigramSimilarity } from '@/lib/similarity'

/**
 * LUM-538 — deterministic extraction gate (source de-duplication).
 *
 * Runs AFTER the grounding gate (LUM-396) and BEFORE neighbor retrieval /
 * reconcile, and on the manual write path before dedup. It is the "fix the
 * generator, not the product" half of P1: keep two classes of low-value rows
 * out of the corpus at the source so P5 cleanup doesn't have to recur.
 *
 *  1. INCOMPLETE_FACT — a half-sentence fragment with no actionable content
 *     (the old cryptic-log-line failure mode, e.g. "Session.taskId divergence").
 *     This is NOT a length gate: a terse-but-complete fragment ("No console.log",
 *     "Use named exports") must survive — the criterion explicitly forbids
 *     regressing into over-rejecting concise good memories. The discriminator is
 *     a *proposition signal* (a verb / modal / connective, or ≥4 words), not word
 *     count.
 *  2. CONSTITUTION_REDUNDANT — the candidate restates a rule the project
 *     constitution (CLAUDE.md / AGENTS.md) already documents. Memory exists for
 *     knowledge invisible in code/docs; a constitution rule is already resident
 *     context. Layer 2 already does this via an LLM prompt; this extends the
 *     check to the SOURCE (Layer 1 + manual add) with a deterministic lexical
 *     match so it runs without a gateway call.
 *
 * Both checks are pure functions of their inputs, so they are unit-testable in
 * both directions (drop the bad, keep the good) with no gateway.
 */

/** Every reason the gate can reject for — exhaustive, so message mappings can be
 * tested against the full set (LUM-778). */
export const SCREEN_REASONS = [
  'INCOMPLETE_FACT',
  'CONSTITUTION_REDUNDANT',
] as const

export type ScreenReason = (typeof SCREEN_REASONS)[number]

/**
 * A rejection carries what a user would need to verify it: a
 * CONSTITUTION_REDUNDANT verdict names the constitution line it matched
 * (LUM-778 — a rejection that points at an unnamed line in an unnamed file is
 * indistinguishable from a made-up reason).
 */
export type ScreenFailure =
  | { ok: false; reason: 'INCOMPLETE_FACT' }
  | { ok: false; reason: 'CONSTITUTION_REDUNDANT'; matchedLine: string }

export type ScreenResult = { ok: true } | ScreenFailure

/** Per-category headline field — the one that must carry a complete proposition. */
function primaryFieldText(category: MemoryCategory, content: unknown): string {
  if (content === null || typeof content !== 'object') return ''
  const c = content as Record<string, unknown>
  const pick = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  switch (category) {
    case 'TRAP':
      return pick(c.trigger)
    case 'DECISION':
      return pick(c.what)
    case 'CONVENTION':
      return pick(c.rule)
    case 'PROCEDURAL':
      return pick(c.workflow)
  }
}

/**
 * Verbs / modals / connectives that signal a complete proposition rather than a
 * bare noun phrase. Deliberately broad (includes copulas like is/are/has) so the
 * gate errs toward KEEPING — over-rejection is the failure mode to avoid.
 */
const PREDICATE_SIGNALS = new Set([
  'no',
  'not',
  'never',
  'avoid',
  'dont',
  'do',
  "don't",
  'use',
  'used',
  'using',
  'run',
  'set',
  'add',
  'prefer',
  'always',
  'must',
  'should',
  'before',
  'after',
  'when',
  'if',
  'because',
  'so',
  'via',
  'returns',
  'return',
  'throws',
  'throw',
  'fails',
  'fail',
  'failed',
  'breaks',
  'break',
  'requires',
  'require',
  'needs',
  'need',
  'keep',
  'wrap',
  'route',
  'store',
  'convert',
  'skip',
  'check',
  'ensure',
  'is',
  'are',
  'was',
  'were',
  'has',
  'have',
  'call',
  'calls',
  'pass',
  'only',
  'instead',
  'until',
  'unless',
  'make',
  'made',
  'put',
  'goes',
  'go',
  'lives',
])

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map(t => t.replace(/^[^\w'→-]+|[^\w'→-]+$/g, ''))
    .filter(Boolean)
}

function hasPredicateSignal(text: string): boolean {
  if (text.includes('→') || text.includes('->')) return true
  return tokenize(text).some(t => PREDICATE_SIGNALS.has(t))
}

/** Below this many words the whole content is too thin to carry a fact. */
const MIN_TOTAL_WORDS = 3
/** At/above this many words the content is substantial enough on its own, even
 * without a recognized signal word (a structured TRAP/PROCEDURAL splits its
 * proposition across fields). */
const SUBSTANTIAL_WORDS = 6

/**
 * A candidate is an incomplete fact when, read in full, it does not state an
 * actionable point. The headline field must be present (a memory with no
 * trigger/what/rule/workflow is a fragment), and the combined content must carry
 * a proposition signal — a verb/modal/connective/arrow — OR run to enough words
 * to be a real note. The check spans ALL fields, not just the headline, because
 * a TRAP's proposition lives in trigger+outcome together and a terse condition
 * like "P3012 on migrate" is a fine trigger when the outcome carries the fix.
 *
 * Deliberately lenient (favors KEEP): the criterion forbids regressing into
 * over-rejecting concise good memories, so only clearly-thin bare-label
 * fragments ("taskId mismatch", "divergence bug") are dropped.
 */
export function isIncompleteFact(
  category: MemoryCategory,
  content: unknown
): boolean {
  if (!primaryFieldText(category, content)) return true // headline missing

  const fullText = memoryContentToText(category, content)
  const totalWords = tokenize(fullText).length
  if (totalWords < MIN_TOTAL_WORDS) return true // ultra-thin, no fact to learn
  if (hasPredicateSignal(fullText)) return false
  if (totalWords >= SUBSTANTIAL_WORDS) return false
  return true // 3–5 words, bare noun phrase, no proposition → incomplete
}

/** Cosine-of-bigrams floor above which a candidate is treated as restating a
 * constitution line. Set well above the ~0.2–0.4 two-unrelated-sentences band so
 * an incidental overlap never rejects a genuine memory; a real restatement
 * (near-verbatim or strong paraphrase) clears it. */
export const CONSTITUTION_REDUNDANCY_FLOOR = 0.55

/** Constitution lines shorter than this are headings / fragments — skip them as
 * match targets so a short heading doesn't spuriously contain a candidate. */
const MIN_CONSTITUTION_LINE_CHARS = 15

function constitutionLines(constitution: string): string[] {
  return constitution
    .split('\n')
    .map(l => l.replace(/^[\s#>*\-+\d.)|`]+/, '').trim())
    .filter(l => l.length >= MIN_CONSTITUTION_LINE_CHARS)
}

/**
 * True when the candidate's content closely restates some line of the project
 * constitution. `constitution` is the combined CLAUDE.md + AGENTS.md text (or
 * null when neither is available — then this check is skipped, fail-open).
 */
export function isConstitutionRedundant(
  category: MemoryCategory,
  content: unknown,
  constitution: string | null
): boolean {
  return findConstitutionRedundantLine(category, content, constitution) !== null
}

/**
 * The constitution line the candidate restates, or null when it restates
 * none (or the constitution is unavailable — fail-open).
 */
export function findConstitutionRedundantLine(
  category: MemoryCategory,
  content: unknown,
  constitution: string | null
): string | null {
  return findTextConstitutionRedundantLine(
    memoryContentToText(category, content),
    constitution
  )
}

/**
 * Text-level variant: true when `text` closely restates some constitution line.
 * The category-free core (shared by the LUM-538 extraction gate and the LUM-539
 * judge marginal-value gate, which sees already-rendered fragment text). Skipped
 * (fail-open) when the constitution is unavailable or the text is empty.
 */
export function isTextConstitutionRedundant(
  text: string | null | undefined,
  constitution: string | null
): boolean {
  return findTextConstitutionRedundantLine(text, constitution) !== null
}

/**
 * Text-level core: the first constitution line whose bigram similarity to
 * `text` clears the floor, or null. Null (fail-open) when the constitution is
 * unavailable or the text is empty.
 */
export function findTextConstitutionRedundantLine(
  text: string | null | undefined,
  constitution: string | null
): string | null {
  if (!constitution) return null
  if (!text) return null
  for (const line of constitutionLines(constitution)) {
    if (bigramSimilarity(text, line) >= CONSTITUTION_REDUNDANCY_FLOOR)
      return line
  }
  return null
}

/**
 * Screen one candidate. INCOMPLETE_FACT is checked first (cheap, no external
 * input); CONSTITUTION_REDUNDANT second. Returns `{ ok: true }` to keep.
 */
export function screenCandidate(input: {
  category: MemoryCategory
  content: unknown
  constitution: string | null
}): ScreenResult {
  if (isIncompleteFact(input.category, input.content)) {
    return { ok: false, reason: 'INCOMPLETE_FACT' }
  }
  const matchedLine = findConstitutionRedundantLine(
    input.category,
    input.content,
    input.constitution
  )
  if (matchedLine !== null) {
    return { ok: false, reason: 'CONSTITUTION_REDUNDANT', matchedLine }
  }
  return { ok: true }
}
