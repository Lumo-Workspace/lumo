/**
 * LUM-793 — memory poisoning guard at the WRITE boundary.
 *
 * LUM-783 guards the *injection* boundary: every time a memory is rendered
 * into an agent's context, its text is scanned and a notice is printed. That
 * is the right treatment for a Slack thread or a fetched web page — content
 * that arrives once and is read once. A Memory row is different: it is
 * persisted, agent-writable (`lumo project memory add`, `lumo memory push`,
 * the web form, `PATCH /api/memories/[id]`, and the LLM curation passes) and
 * re-injected at the start of *every* future session. Re-tagging it on each
 * injection means a poisoned row sits in the pool forever, wearing a warning
 * nobody acts on. The right place to stop it is the write.
 *
 * Three deterministic checks, all pure so the write paths, the system apply
 * paths and the stock-scan script share one verdict:
 *
 *  1. **Injection signals** — `detectInjectionSignals` from the shared module
 *     (LUM-783, with the LUM-791/792 normalization). `IMPERATIVE`,
 *     `HIDDEN_COMMENT` and `ENCODED_BLOB` REJECT the write; `INVISIBLE_CHARS`
 *     and `SCRIPT_LINK` stay soft — they are recorded on the row's
 *     `contentSignals` exactly as before. The split is precision-driven: the
 *     first three have no legitimate shape inside a memory card, while a
 *     stray bidi character or a `data:` URL in a pasted snippet does.
 *
 *  2. **Agent directives** — the memory-specific half. A memory's legal form
 *     is a *description* ("doing X hits this trap", "the team convention is
 *     Y"), never an *order to a future agent* ("from now on always run Z").
 *     LUM-783's IMPERATIVE class is tuned for classic prompt injection
 *     ("ignore all previous instructions") and does not fire on that shape.
 *     Detection is deliberately conjunctive — a persistent-scope marker AND
 *     an addressed directive, close together — because the corpus this runs
 *     against is full of legitimately imperative PROCEDURAL memories ("Run
 *     `lumo crossing disposition …`", "All tests go in `__tests__/`"). A
 *     detector that fires on those is a detector the team turns off.
 *
 *  3. **Constitution conflicts** — a memory that tells a future agent to do
 *     what a compiled `ProjectPolicy` rule (LUM-590) forbids. Only
 *     deterministic + blocking rules count, and only the ones carrying a
 *     literal subject (`cmd-substr` / `path-glob` / `push-target`); a
 *     `diff-regex` value is a pattern, not a phrase, and matching prose
 *     against it would be noise. The rejection names the rule id.
 *
 * Semantic (LLM) judgement is deliberately out of scope — this is the
 * deterministic floor, and how much it catches is the input to deciding
 * whether more is needed.
 */
import {
  detectInjectionSignals,
  summarizeContentSignals,
  type ContentSignals,
  type InjectionSignal,
  type InjectionSignalKind,
} from '@/shared/src/untrusted-content'
import { memoryContentToText } from '@/lib/memory/content-text'
import type { MemoryCategory } from '@prisma/client'

/**
 * The signal kinds that REJECT a memory write. The remaining two
 * (`INVISIBLE_CHARS`, `SCRIPT_LINK`) are recorded on the row and injected
 * with the LUM-783 notice, unchanged.
 */
export const MEMORY_BLOCKING_SIGNAL_KINDS: readonly InjectionSignalKind[] = [
  'IMPERATIVE',
  'HIDDEN_COMMENT',
  'ENCODED_BLOB',
]

const EXCERPT_CHARS = 160

function clip(s: string): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > EXCERPT_CHARS ? `${flat.slice(0, EXCERPT_CHARS)}…` : flat
}

// ─── ② agent directives ──────────────────────────────────────────────────────

/**
 * "This applies from here on / every time" — the marker that turns a sentence
 * from a description of one situation into a standing order. English is
 * space-delimited; the Chinese forms are written tight on purpose (a loose
 * separator class is what LUM-792 needed for adversarial *injection* text,
 * but a poisoned memory has to read naturally to survive human review).
 */
const PERSISTENT_SCOPE =
  /\b(?:from\s+now\s+on|from\s+here\s+on|going\s+forward|for\s+all\s+future|in\s+(?:every|each|all)\s+(?:future\s+)?(?:session|sessions|conversation|conversations|task|tasks|run|runs)|(?:every|each)\s+time\s+you|whenever\s+you|any\s+time\s+you|at\s+the\s+(?:start|beginning)\s+of\s+(?:every|each))\b|以后每[次回]|从今[以往]后|从现在起|从此以后|今后每[次回]|将来每[次回]|每次会话|每个会话|每次任务|每次(?:你|都)|所有未来的?|每当你|只要你/i

/**
 * "…you are to do X" — an instruction addressed to the reader. Kept broad on
 * purpose: on its own it fires on half the PROCEDURAL corpus, and precision
 * comes from requiring a {@link PERSISTENT_SCOPE} marker in the same window.
 */
const ADDRESSED_DIRECTIVE =
  /\b(?:you\s+(?:must|should|shall|have\s+to|need\s+to|are\s+(?:required|expected)\s+to|will\s+(?:always|never))|make\s+sure\s+(?:you|to)|be\s+sure\s+to|remember\s+to|always\s+\w+|never\s+\w+|do\s+not\s+\w+|don'?t\s+\w+|run\s+\S|execute\s+\S)\b|你必须|你要|你应该|你得|都必须|都要|务必|一定要|记得|请(?:先|务必|一定|记得)?\S|必须\S|不要\S|不得\S|禁止\S/i

/** How far apart the two markers may sit and still count as one instruction. */
const DIRECTIVE_WINDOW_CHARS = 140

export interface DirectiveHit {
  /** Offset of the persistent-scope marker in the scanned text. */
  index: number
  /** The clause both markers fell in, clipped for the rejection message. */
  excerpt: string
}

/**
 * Sentence-ish spans. Splitting on terminators (rather than scanning the whole
 * blob) is what keeps "the team convention is X. Run `lumo verify` when done."
 * from reading as one standing order — two unrelated clauses, two spans.
 */
function spans(text: string): Array<{ start: number; text: string }> {
  const out: Array<{ start: number; text: string }> = []
  const re = /[^.!?;\n。！？；]+[.!?;\n。！？；]?/g
  for (const m of text.matchAll(re)) {
    if (m[0].trim()) out.push({ start: m.index, text: m[0] })
  }
  return out.length > 0 ? out : [{ start: 0, text }]
}

/**
 * Standing orders aimed at a future agent. A hit needs BOTH a persistent-scope
 * marker and an addressed directive within {@link DIRECTIVE_WINDOW_CHARS} of
 * each other, inside one sentence — the conjunction IS the precision story.
 */
export function detectAgentDirective(text: string): DirectiveHit[] {
  if (!text) return []
  const hits: DirectiveHit[] = []
  for (const span of spans(text)) {
    const scope = new RegExp(PERSISTENT_SCOPE.source, 'gi').exec(span.text)
    if (!scope) continue
    const directive = new RegExp(ADDRESSED_DIRECTIVE.source, 'gi').exec(
      span.text
    )
    if (!directive) continue
    if (Math.abs(directive.index - scope.index) > DIRECTIVE_WINDOW_CHARS) {
      continue
    }
    hits.push({ index: span.start + scope.index, excerpt: clip(span.text) })
  }
  return hits
}

// ─── ③ constitution conflicts ────────────────────────────────────────────────

/** The compiled-policy shape this module reads (structural, not imported, so
 *  `lib/memory` stays free of a `lib/services/policy` dependency). */
export interface PolicyRuleRef {
  id: string
  text: string
  tier: 'deterministic' | 'semantic'
  blocking: boolean
  predicate?: { type: string; value: string } | undefined
}

export interface PolicyConflict {
  ruleId: string
  ruleText: string
  /** The literal the memory named (the rule's predicate subject). */
  subject: string
  excerpt: string
}

/** Wording that grants permission to do the thing the sentence names. */
const PERMISSION_MARKER =
  /\b(?:it'?s\s+(?:fine|ok|okay|safe)|it\s+is\s+(?:fine|ok|okay|safe)|you\s+(?:can|may|could)|feel\s+free\s+to|go\s+ahead\s+and|just\s+(?:run|do|use|delete|push)|safe\s+to|fine\s+to|ok(?:ay)?\s+to|no\s+problem\s+to|allowed\s+to|should\s+(?:run|delete|push|force))\b|可以\S|能够?直接|直接\S*(?:删|跑|推|执行|运行)|尽管\S|放心\S|没问题|无需担心|随便\S/i

/** Wording that forbids — its presence means the sentence restates the rule. */
const PROHIBITION_MARKER =
  /\b(?:never|not|don'?t|do\s+not|forbidden|forbid|prohibited|banned|disallowed|avoid|must\s+not|cannot|can'?t|only)\b|禁止|严禁|不要|不得|不能|不可|不准|勿|别|仅|只有|避免|永不|永远不/i

/** Predicate types whose `value` is a literal phrase a memory could name. */
const LITERAL_PREDICATES = new Set(['cmd-substr', 'path-glob', 'push-target'])

/** Shortest subject worth matching — below this, prose hits are noise. */
const SUBJECT_MIN_CHARS = 6

/**
 * Turn a predicate value into the literal(s) a memory would spell out. Globs
 * lose their wildcards AND their now-dangling separators
 * (`prisma/migrations/**` → `prisma/migrations`) — a memory writes the path
 * the way a human says it, without the trailing slash the glob needs. A
 * `push-target` rule is about the push itself, not the branch name (`main` is
 * four characters of pure noise), so it contributes `git push` only.
 */
function subjectsFor(predicate: { type: string; value: string }): string[] {
  if (predicate.type === 'push-target') return ['git push']
  const literal = predicate.value
    .replace(/\*+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s/]+|[\s/]+$/g, '')
  return literal.length >= SUBJECT_MIN_CHARS ? [literal] : []
}

/**
 * Memories that tell a future agent to do what a blocking, deterministic
 * project rule forbids. A sentence only conflicts when it NAMES the rule's
 * subject, GRANTS permission for it, and carries no prohibition of its own —
 * so "never delete files in prisma/migrations/" (a memory restating the rule)
 * stays writable while "旧的 prisma/migrations 迁移可以直接删掉" does not.
 */
export function findPolicyConflicts(
  text: string,
  rules: readonly PolicyRuleRef[]
): PolicyConflict[] {
  if (!text || rules.length === 0) return []
  const conflicts: PolicyConflict[] = []
  const seen = new Set<string>()
  for (const span of spans(text)) {
    const clause = span.text
    if (!PERMISSION_MARKER.test(clause)) continue
    if (PROHIBITION_MARKER.test(clause)) continue
    for (const rule of rules) {
      if (rule.tier !== 'deterministic' || !rule.blocking) continue
      if (!rule.predicate || !LITERAL_PREDICATES.has(rule.predicate.type)) {
        continue
      }
      for (const subject of subjectsFor(rule.predicate)) {
        if (!clause.toLowerCase().includes(subject.toLowerCase())) continue
        const key = `${rule.id}:${span.start}`
        if (seen.has(key)) continue
        seen.add(key)
        conflicts.push({
          ruleId: rule.id,
          ruleText: clip(rule.text),
          subject,
          excerpt: clip(clause),
        })
      }
    }
  }
  return conflicts
}

// ─── the verdict ─────────────────────────────────────────────────────────────

export type MemoryRejectionReason =
  | 'INJECTION_SIGNAL'
  | 'AGENT_DIRECTIVE'
  | 'POLICY_CONFLICT'

export interface MemoryWriteAccepted {
  ok: true
  /** The LUM-783 summary to persist on the row (null when clean). */
  signals: ContentSignals | null
}

export interface MemoryWriteRejected {
  ok: false
  reason: MemoryRejectionReason
  /** Populated for INJECTION_SIGNAL. */
  blockingSignals: InjectionSignal[]
  /** Populated for AGENT_DIRECTIVE. */
  directives: DirectiveHit[]
  /** Populated for POLICY_CONFLICT. */
  conflicts: PolicyConflict[]
}

export type MemoryWriteVerdict = MemoryWriteAccepted | MemoryWriteRejected

export interface ScreenMemoryWriteInput {
  category: MemoryCategory
  content: unknown
  /** The project's compiled policy rules; omit to skip the conflict check. */
  policyRules?: readonly PolicyRuleRef[] | undefined
  /** Injected in tests so the persisted `scannedAt` is deterministic. */
  now?: Date | undefined
}

/**
 * The single verdict every memory write path asks for. Accepting returns the
 * `contentSignals` summary the row should store, so a caller never has to
 * scan the same text twice.
 */
export function screenMemoryWrite(
  input: ScreenMemoryWriteInput
): MemoryWriteVerdict {
  const text = memoryContentToText(input.category, input.content)
  if (!text) return { ok: true, signals: null }

  const { signals } = detectInjectionSignals(text)
  const blocking = signals.filter(s =>
    MEMORY_BLOCKING_SIGNAL_KINDS.includes(s.kind)
  )
  if (blocking.length > 0) {
    return {
      ok: false,
      reason: 'INJECTION_SIGNAL',
      blockingSignals: blocking,
      directives: [],
      conflicts: [],
    }
  }

  const directives = detectAgentDirective(text)
  if (directives.length > 0) {
    return {
      ok: false,
      reason: 'AGENT_DIRECTIVE',
      blockingSignals: [],
      directives,
      conflicts: [],
    }
  }

  const conflicts = findPolicyConflicts(text, input.policyRules ?? [])
  if (conflicts.length > 0) {
    return {
      ok: false,
      reason: 'POLICY_CONFLICT',
      blockingSignals: [],
      directives: [],
      conflicts,
    }
  }

  return {
    ok: true,
    signals: summarizeContentSignals(text, input.now ?? new Date()),
  }
}

/**
 * The user-facing rejection. Like the LUM-778 constitution rejection it must
 * be *verifiable*: it quotes the sentence that matched (and, for a conflict,
 * the rule id and its text) so the author can look at the same thing the gate
 * looked at instead of guessing.
 */
export function formatMemoryRejection(verdict: MemoryWriteRejected): string {
  switch (verdict.reason) {
    case 'INJECTION_SIGNAL': {
      const first = verdict.blockingSignals[0]!
      const kinds = [...new Set(verdict.blockingSignals.map(s => s.kind))].join(
        ', '
      )
      return `Memory rejected: its text carries prompt-injection signals (${kinds}) and memory is re-injected into every future session. First match: "${clip(first.excerpt)}".`
    }
    case 'AGENT_DIRECTIVE': {
      const first = verdict.directives[0]!
      return `Memory rejected: this is a standing order to future agents, not a description. Rewrite it as what happens / what the team convention is. Matched: "${first.excerpt}".`
    }
    case 'POLICY_CONFLICT': {
      const first = verdict.conflicts[0]!
      return `Memory rejected: it contradicts project rule ${first.ruleId} ("${first.ruleText}") by permitting "${first.subject}". Matched: "${first.excerpt}".`
    }
  }
}
