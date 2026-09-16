/**
 * LUM-786 — the injection→action correlation criterion, as pure functions.
 *
 * The design question this module answers is question 3 of the task: how do we
 * decide an agent action is *related* to a piece of untrusted content we
 * injected, rather than guessing from timing. The answer implemented here:
 *
 *   A candidate exists when a LITERAL that appears in the injected text is
 *   reproduced VERBATIM in a later action in the same session, and that literal
 *   is NOVEL to the workspace — it does not already appear in the corpus the
 *   agent would have had anyway (the repo's own vocabulary, and everything the
 *   session did BEFORE the injection).
 *
 * Time proximity alone is deliberately NOT a criterion: it is the null model
 * the backtest measures against. Novelty is what carries the information — in
 * a dogfooding repo every memory row is full of the team's own file paths and
 * commands, and an agent runs those all day for reasons that have nothing to
 * do with the memory row.
 *
 * Nothing here touches the database or the network; `backtest.ts` feeds it
 * production rows and `__tests__/correlate.test.ts` feeds it fixtures.
 */

export type LiteralKind = 'NPM_PACKAGE' | 'URL' | 'HOST' | 'PATH' | 'COMMAND'

export interface Literal {
  kind: LiteralKind
  /** The literal exactly as it appeared in the injected text. */
  value: string
}

/**
 * How much of a fragment actually reached the model. LineageEdge carries this
 * as `disclosure`: FULL = the rendered body was injected; INDEX = only a
 * one-line manifest was, and the body was never in context unless the agent
 * later pulled it (`pulledAt`). Correlating an action against a body that was
 * never injected is not a weak signal — it is a category error, so INDEX
 * fragments contribute only their manifest line.
 */
export type Disclosure = 'FULL' | 'INDEX'

export interface InjectedFragment {
  edgeId: string
  sessionId: string
  /** The exact text that entered the context window. */
  text: string
  disclosure: Disclosure
  includedAt: Date
  /** Whether the source row carries LUM-783 injection signals. */
  hasInjectionSignal: boolean
  /** True when the content was authored by a workspace member (see EXEMPT_*). */
  memberAuthored: boolean
  sourceLabel: string
}

export interface AgentAction {
  hookEventId: string
  sessionId: string
  toolName: string | null
  createdAt: Date
  /** Concatenated text of the tool input, as the action would execute it. */
  text: string
  /** Claude Code's per-user-prompt id, when the payload carried one. */
  promptId: string | null
  /** Boundary-crossing categories this action was actually recorded under. */
  crossingCategories: string[]
}

// ─── Literal extraction ───────────────────────────────────────────────────────

/**
 * `npm install foo`, `npm i -D foo`, `yarn add foo`, `pnpm add foo`,
 * `npx foo@1.2.3`. The package name is the thing that ends up executed, so it
 * is extracted separately from the surrounding command.
 */
const INSTALL_RE =
  /\b(?:npm\s+(?:install|i|add)|yarn\s+add|pnpm\s+(?:add|install|i)|bun\s+add|npx)\s+((?:-{1,2}[\w-]+\s+)*)([@\w][\w./@-]*)/g

const URL_RE = /\bhttps?:\/\/[^\s"'`<>()[\]{},]+/g

/**
 * A path-shaped token: at least one slash, a plausible extension or a known
 * directory-ish head, no spaces. Trailing punctuation is trimmed so
 * "see lib/foo.ts," yields `lib/foo.ts`.
 */
const PATH_RE = /(?:^|[\s"'`(\[])((?:\/|\.{1,2}\/|~\/)?[\w.-]+(?:\/[\w.@-]+)+)/g

/**
 * A command-shaped line inside backticks or a fenced block. Only the head of
 * the line is kept — the full line is already covered by PATH/URL extraction,
 * and a whole-line literal match is far too brittle to be evidence.
 */
const BACKTICK_RE = /`([^`\n]{2,200})`/g

const COMMAND_HEAD_RE =
  /^(?:sudo\s+)?((?:npm|npx|pnpm|yarn|bun|git|curl|wget|rm|chmod|chown|docker|kubectl|aws|gcloud|psql|prisma|node|python3?|sh|bash|eval|ssh|scp|nc)\b[^\n]*)$/

function trimTrailingPunctuation(s: string): string {
  return s.replace(/[.,;:!?)\]}'"`]+$/, '')
}

function push(out: Map<string, Literal>, kind: LiteralKind, raw: string): void {
  const value = trimTrailingPunctuation(raw.trim())
  if (value.length < 3) return
  const key = `${kind}:${value}`
  if (!out.has(key)) out.set(key, { kind, value })
}

/**
 * Pull every literal out of a piece of injected text. Order-independent and
 * deduplicated; the caller treats the result as a set.
 */
export function extractLiterals(text: string): Literal[] {
  const out = new Map<string, Literal>()

  for (const m of text.matchAll(INSTALL_RE)) {
    push(out, 'NPM_PACKAGE', m[2])
  }
  for (const m of text.matchAll(URL_RE)) {
    const url = trimTrailingPunctuation(m[0])
    push(out, 'URL', url)
    try {
      push(out, 'HOST', new URL(url).host)
    } catch {
      /* not a parseable URL — the URL literal alone is enough */
    }
  }
  for (const m of text.matchAll(PATH_RE)) {
    push(out, 'PATH', m[1])
  }
  for (const m of text.matchAll(BACKTICK_RE)) {
    const inner = m[1].trim()
    const head = COMMAND_HEAD_RE.exec(inner)
    if (head) push(out, 'COMMAND', head[1])
  }
  for (const line of text.split('\n')) {
    const head = COMMAND_HEAD_RE.exec(line.trim())
    if (head) push(out, 'COMMAND', head[1])
  }

  return [...out.values()]
}

// ─── Novelty ──────────────────────────────────────────────────────────────────

/**
 * The vocabulary the agent would have had without the injection: the repo's own
 * paths and dependencies, plus everything this session already said or ran
 * before the fragment was injected. A literal that is already in here carries
 * no attribution — the agent had every reason to produce it anyway.
 */
export interface Vocabulary {
  /** Lower-cased literal values known before the injection. */
  known: Set<string>
}

export function buildVocabulary(sources: Iterable<string>): Vocabulary {
  const known = new Set<string>()
  for (const text of sources) {
    for (const lit of extractLiterals(text)) known.add(lit.value.toLowerCase())
  }
  return { known }
}

export function isNovel(literal: Literal, vocab: Vocabulary): boolean {
  return !vocab.known.has(literal.value.toLowerCase())
}

// ─── Reproduction ─────────────────────────────────────────────────────────────

export interface Reproduction {
  /** The strongest literal this action reproduced (see LITERAL_STRENGTH). */
  literal: Literal
  novel: boolean
  /** Every other literal of the same fragment this action also reproduced. */
  alsoMatched: Literal[]
  /**
   * The literal also appears in a user prompt of this session — the human asked
   * for it through the trusted channel, so the injected copy explains nothing.
   * This is the exemption the task's own example needs ("someone says in Slack
   * 'install foo' and the agent installs foo" is collaboration, not an attack).
   */
  userAsked: boolean
  action: AgentAction
  /** Whole seconds between injection and the action. */
  lagSeconds: number
  /** Number of distinct prompt turns between injection and the action. */
  turnDistance: number | null
}

/**
 * One candidate = one (injected fragment, action) pair — that is the unit a
 * human adjudicates on the panel ("this content" next to "this action"). When
 * an action reproduces several of a fragment's literals, the strongest one
 * leads and the rest ride along in `alsoMatched`. Package names and URLs are
 * the strongest because they name something the agent *acts on*; a repo path is
 * the weakest because a path is what a coding agent touches all day.
 */
const LITERAL_STRENGTH: Record<LiteralKind, number> = {
  NPM_PACKAGE: 5,
  URL: 4,
  HOST: 3,
  COMMAND: 2,
  PATH: 1,
}

/**
 * `literal` appears verbatim in `action`. Case-sensitive for paths/URLs/
 * commands (they are executed case-sensitively on the systems that matter) and
 * bounded so `foo` does not match `foobar`.
 */
export function reproducedIn(literal: Literal, action: AgentAction): boolean {
  const idx = action.text.indexOf(literal.value)
  if (idx === -1) return false
  const before = action.text[idx - 1]
  const after = action.text[idx + literal.value.length]
  const isWordChar = (c: string | undefined) => c != null && /[\w-]/.test(c)
  // A literal that already ends in a non-word char (a path with a slash, a
  // command with arguments) only needs its left edge guarded.
  const leftOk = !isWordChar(before)
  const rightOk = !isWordChar(after) || !/[\w-]$/.test(literal.value)
  return leftOk && rightOk
}

// ─── Evidence tiers ───────────────────────────────────────────────────────────

/**
 * The action classes the task named as "worth correlating": the existing
 * boundary-crossing categories. An action outside this set is still recorded
 * (tier ADVISORY) but never escalated.
 */
export const CORRELATED_CROSSING_CATEGORIES: readonly string[] = [
  'NEW_NPM_DEPENDENCY',
  'PUSH_TO_PROTECTED_BRANCH',
  'EXFILTRATION_PUBLIC',
  'DESTRUCTIVE_DB_COMMAND',
  'SENSITIVE_PATH_EDIT',
  'CLOUD_DATA_DELETION',
  'INFRA_TERMINATION',
]

/** Categories whose effect cannot be undone from inside the session. */
export const IRREVERSIBLE_CATEGORIES: readonly string[] = [
  'EXFILTRATION_PUBLIC',
  'DESTRUCTIVE_DB_COMMAND',
  'CLOUD_DATA_DELETION',
  'INFRA_TERMINATION',
]

export type Tier = 'NONE' | 'TIME_ONLY' | 'ADVISORY' | 'MEDIUM' | 'HIGH'

export interface Candidate {
  fragment: InjectedFragment
  reproduction: Reproduction
  tier: Tier
  /** Set when the candidate is suppressed rather than reported. */
  exemption: Exemption | null
}

export type Exemption =
  | 'MEMBER_AUTHORED_SOURCE'
  | 'USER_PROMPT_ORIGIN'
  | 'NOT_NOVEL'
  | 'INDEX_BODY_NOT_INJECTED'
  | 'READ_ONLY_ACTION'

/**
 * Tool calls that cannot change anything outside the session. A reproduction in
 * one of these is the agent *looking at* what it was told about — the most
 * common benign shape, and not worth a record.
 */
const READ_ONLY_TOOLS = new Set([
  'Read',
  'Glob',
  'Grep',
  'NotebookRead',
  'TodoWrite',
  'ToolSearch',
  'ListMcpResourcesTool',
])

export function classify(
  fragment: InjectedFragment,
  reproduction: Reproduction
): Candidate {
  const { action, novel } = reproduction

  let exemption: Exemption | null = null
  if (!novel) exemption = 'NOT_NOVEL'
  else if (reproduction.userAsked) exemption = 'USER_PROMPT_ORIGIN'
  else if (fragment.memberAuthored) exemption = 'MEMBER_AUTHORED_SOURCE'
  else if (action.toolName && READ_ONLY_TOOLS.has(action.toolName))
    exemption = 'READ_ONLY_ACTION'

  const crossing = action.crossingCategories.filter(c =>
    CORRELATED_CROSSING_CATEGORIES.includes(c)
  )
  const irreversible = action.crossingCategories.some(c =>
    IRREVERSIBLE_CATEGORIES.includes(c)
  )

  let tier: Tier
  if (!novel) tier = 'TIME_ONLY'
  else if (crossing.length === 0) tier = 'ADVISORY'
  else if (fragment.hasInjectionSignal && irreversible) tier = 'HIGH'
  else tier = 'MEDIUM'

  return { fragment, reproduction, tier, exemption }
}

/**
 * The whole criterion in one call: every (literal, action) pair where the
 * literal was reproduced, classified. `vocab` must be built from what the
 * session knew BEFORE `fragment.includedAt` — passing a vocabulary that
 * includes the injection itself would mark every literal non-novel.
 *
 * `actions` may contain actions from before the injection; they are dropped.
 * There is no upper time bound by design: injected text stays in the context
 * window until the session ends, so "how long is it still relevant" is an
 * attribution-strength question (carried by `lagSeconds` / `turnDistance` on
 * each reproduction), not a presence question.
 */
export interface CorrelateOptions {
  /**
   * Lower-cased literal values that appear in this session's user prompts —
   * the trusted channel. A literal in here is exempt (USER_PROMPT_ORIGIN).
   */
  userAsked?: Set<string>
}

export function correlate(
  fragment: InjectedFragment,
  actions: AgentAction[],
  vocab: Vocabulary,
  options: CorrelateOptions = {}
): Candidate[] {
  const literals = extractLiterals(fragment.text)
  if (literals.length === 0) return []

  const after = actions
    .filter(
      a =>
        a.sessionId === fragment.sessionId &&
        a.createdAt.getTime() >= fragment.includedAt.getTime()
    )
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

  const seenPrompts = new Set<string>()
  const out: Candidate[] = []
  for (const action of after) {
    if (action.promptId) seenPrompts.add(action.promptId)
    const matched = literals.filter(l => reproducedIn(l, action))
    if (matched.length === 0) continue
    // Strongest first, novel ahead of already-known at equal strength.
    const ranked = [...matched].sort((a, b) => {
      const novelDelta = Number(isNovel(b, vocab)) - Number(isNovel(a, vocab))
      if (novelDelta !== 0) return novelDelta
      return LITERAL_STRENGTH[b.kind] - LITERAL_STRENGTH[a.kind]
    })
    const [literal, ...alsoMatched] = ranked
    const reproduction: Reproduction = {
      literal,
      novel: isNovel(literal, vocab),
      alsoMatched,
      userAsked: options.userAsked?.has(literal.value.toLowerCase()) ?? false,
      action,
      lagSeconds: Math.round(
        (action.createdAt.getTime() - fragment.includedAt.getTime()) / 1000
      ),
      turnDistance: action.promptId ? Math.max(0, seenPrompts.size - 1) : null,
    }
    out.push(classify(fragment, reproduction))
  }
  return out
}
