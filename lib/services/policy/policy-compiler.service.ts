/**
 * Policy compiler service — reads CLAUDE.md/AGENTS.md from the project repo,
 * classifies rules via an LLM (with hash-based caching), persists the result
 * in ProjectPolicy, and emits POLICY_WEAKENING boundary crossings when a
 * deterministic blocking rule is removed from the compiled policy (LUM-590).
 *
 * Fail-safe contract:
 * - If CLAUDE.md and AGENTS.md are both absent → return null (no policy).
 * - If the LLM call fails → return the previous policy (or null if first run).
 * - Never throw out of ensureCompiled.
 *
 * Single-flight contract (LUM-774): a recompile is keyed on
 * (projectId, sourceHash) and lands at most ONE row and ONE weakening diff,
 * however many callers race for it. Two layers, weakest first:
 * - in-process: concurrent callers in the same instance share one promise
 *   (one model call). Instance-local — serverless instances don't share it.
 * - database: `project_policies` has a unique key on (projectId, sourceHash);
 *   persisting is insert-or-ignore, and only the caller whose insert created
 *   the row runs `emitWeakening`. A loser serves the winner's row.
 */
import { createHash } from 'crypto'
import {
  projectPolicyRepository,
  type StoredProjectPolicy,
} from '@/lib/repositories/project-policy.repository'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { logger } from '@/lib/logger'
import { ruleTextPresentIn } from '@/lib/boundary-crossing/rejudge-cause'
import { isReversible } from '@/lib/services/boundary-detector.service'
import { isObligationText } from './rule-polarity'
import { pushRuleShape } from './push-rule'
import type { CompiledPolicy, PolicyRule, RawPolicyRule } from './types'

/**
 * Part of the policy cache key alongside the source text. Bump it whenever the
 * prompt or the post-processing below changes what a given CLAUDE.md compiles
 * to, so every project recompiles exactly once on its next hook event instead
 * of serving a stale rule set until someone edits the doc (LUM-770: the stored
 * policies carried the tsc-obligation-as-prohibition rule).
 */
export const COMPILER_VERSION = 'lum772'

// ── In-memory source cache ────────────────────────────────────────────────────
// Avoids 2 GitHub API reads on every PostToolUse event (ensureCompiled hot path).
// TTL = 60 s; the downstream sha256 hash check catches stale-but-different source.
const SOURCE_CACHE_TTL_MS = 60_000
const _sourceCache = new Map<string, { source: string | null; at: number }>()

/** Exported only for test teardown — do not call in production code. */
export function __resetSourceCache(): void {
  _sourceCache.clear()
}

// ── In-process single-flight (LUM-774) ───────────────────────────────────────
// Callers that need the same (projectId, sourceHash) compiled while one is
// already running share its promise, so a burst of hook events from parallel
// sessions costs one model call. Instance-local: it dedupes within one
// serverless instance only — across instances the unique key on
// project_policies is the guarantee (see compileAndPersist).
const _inflight = new Map<string, Promise<CompiledPolicy | null>>()

/** Exported only for test teardown — do not call in production code. */
export function __resetInflight(): void {
  _inflight.clear()
}

// The action built-ins that may produce blocking crossings (LUM-590; the three
// L4 session-guard classes added in LUM-736 — a path-glob rule mapped to
// SENSITIVE_PATH_EDIT overrides the detector's default sensitive-path set).
const BUILTIN_CATEGORIES = [
  'PUSH_TO_PROTECTED_BRANCH',
  'MIGRATION_FILE_DELETED',
  'HARDCODED_SECRET',
  'NEW_NPM_DEPENDENCY',
  'DESTRUCTIVE_DB_COMMAND',
  'EXFILTRATION_PUBLIC',
  'CLOUD_DATA_DELETION',
  'INFRA_TERMINATION',
  'DESTRUCTIVE_FS_COMMAND',
  'SENSITIVE_PATH_EDIT',
  'HOOK_BYPASS',
  'TEST_FILE_DELETED',
] as const

/** Stable rule id — sha256 of rule text, first 16 hex chars. */
function ruleId(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

/** Fetch and concatenate CLAUDE.md + AGENTS.md from the project repo. */
async function readSource(
  projectId: string,
  workspaceId: string,
  fullName: string
): Promise<string | null> {
  const cached = _sourceCache.get(projectId)
  if (cached && Date.now() - cached.at < SOURCE_CACHE_TTL_MS) {
    return cached.source
  }
  const { readRepoFile } = await import('@/lib/integrations/github/contents')
  const [claude, agents] = await Promise.all([
    readRepoFile({ workspaceId, fullName, path: 'CLAUDE.md' }),
    readRepoFile({ workspaceId, fullName, path: 'AGENTS.md' }),
  ])
  const source =
    claude == null && agents == null
      ? null
      : [claude ?? '', agents ?? ''].join('\n\n')
  _sourceCache.set(projectId, { source, at: Date.now() })
  return source
}

/**
 * Crossings for deterministic+blocking rules that no longer are.
 *
 * The discriminator is NOT "did the rule set change" — it is **is the rule's
 * text still in the source**. Those are different questions, and conflating
 * them is what made this detector cry wolf:
 *
 *  - `sourceHash` is salted with COMPILER_VERSION, so bumping the compiler
 *    forces a recompile of an UNCHANGED CLAUDE.md. LUM-770 bumped it, and its
 *    own safety net — which deliberately downgrades an obligation carrying a
 *    cmd-substr predicate — then reported itself as a HIGH policy weakening.
 *  - rule identity is `sha256(text)` of LLM-extracted text, so a classifier
 *    that paraphrases by one character produces a new id and the old one reads
 *    as "removed". Observed 4 times for one untouched rule in a single day.
 *
 * A rule whose text is still in the file was not weakened by a person. That is
 * still worth recording — a classifier that quietly stops treating a Forbidden
 * line as deterministic leaves the project less protected in practice — but as
 * ADVISORY, attributed to the compiler, and not blocking anyone's DONE.
 *
 * A same-id difference is definitionally this case: the id IS the text hash, so
 * identical id means identical text means nobody edited that rule.
 */
async function emitWeakening(
  prevRules: PolicyRule[],
  nextRules: PolicyRule[],
  taskId: string,
  source: string
): Promise<void> {
  const nextById = new Map(nextRules.map(r => [r.id, r]))
  const weakened = prevRules.filter(r => {
    if (!(r.tier === 'deterministic' && r.blocking)) return false
    const next = nextById.get(r.id)
    if (next == null) return true // removed
    return !(next.tier === 'deterministic' && next.blocking) // downgraded
  })
  for (const r of weakened) {
    // LUM-780: one shared predicate with the re-judge (tolerates a trailing
    // classifier gloss on the rule side; the source is never loosened).
    const stillInSource = ruleTextPresentIn(source, r.text)
    const detail = stillInSource
      ? `The policy compiler stopped treating this rule as deterministic+blocking, but its text is UNCHANGED in CLAUDE.md — a classifier decision, not an edit: "${r.text}"`
      : `A deterministic Forbidden rule was removed from CLAUDE.md: "${r.text}"`
    await boundaryCrossingRepository.create({
      taskId,
      category: 'POLICY_WEAKENING',
      severity: stillInSource ? 'MEDIUM' : 'HIGH',
      advisory: stillInSource,
      detail,
      target: `weakening:${r.id}`,
      // LUM-630: route through the taxonomy instead of eating the
      // repository's `?? false` default.
      reversible: isReversible('POLICY_WEAKENING'),
      policyRuleRef: r.id,
      // LUM-780: the text the re-judge asks the source about — stamped so a
      // future pass never has to recover it from a clipped detail.
      policyRuleText: r.text,
    })
  }
}

/**
 * The deterministic post-processing every compiled rule goes through — pure,
 * exported so a STORED policy can be re-run through the current compiler's
 * view without a model call (the LUM-772 backfill re-judges old crossings
 * against exactly this):
 *
 * - a deterministic rule with neither a known built-in category nor a safe
 *   predicate is downgraded to semantic tier;
 * - LUM-770: an OBLIGATION carrying a cmd-substr predicate ("tests + `npx tsc
 *   --noEmit` pass" before a PR) is downgraded too, and loses the predicate —
 *   the detector reads cmd-substr as "running this is a violation", which
 *   inverts a must-do. Either the model's own polarity or the wording guard is
 *   enough; the guard exists because the model misreading the sentence is the
 *   failure being fixed;
 * - LUM-772: a push PROHIBITION ("never push to main or develop") never keeps
 *   a target-blind predicate (`cmd-substr: "git push"` flagged every
 *   feature-branch push). Mapped to the built-in PUSH_TO_PROTECTED_BRANCH and
 *   naming only built-in-guarded branches → no predicate at all (the built-in,
 *   target-scoped since LUM-464, is the single detector); otherwise → a
 *   `push-target` predicate over the branches the rule names.
 */
export function compileRuleSet(rawRules: RawPolicyRule[]): PolicyRule[] {
  return rawRules.map(r => {
    const hasBuiltin =
      r.mappedCategory != null &&
      (BUILTIN_CATEGORIES as readonly string[]).includes(r.mappedCategory)
    const obligationWithCmdSubstr =
      r.kind === 'action' &&
      r.predicate?.type === 'cmd-substr' &&
      (r.polarity === 'require' || isObligationText(r.text))
    let predicate = obligationWithCmdSubstr ? undefined : r.predicate

    // LUM-772: push prohibitions are judged on the push destination only.
    const push = obligationWithCmdSubstr ? null : pushRuleShape(r)
    if (push) {
      predicate = push.coveredByBuiltin
        ? undefined
        : { type: 'push-target', value: push.branches.join(',') }
    }
    const hasPredicate = predicate != null

    const tier: PolicyRule['tier'] =
      obligationWithCmdSubstr ||
      (r.tier === 'deterministic' && !hasBuiltin && !hasPredicate)
        ? 'semantic'
        : r.tier

    const rule: PolicyRule = {
      id: ruleId(r.text),
      text: r.text,
      kind: r.kind,
      tier,
      severity: r.severity,
      // blocking only when mappedCategory resolves to a known built-in.
      blocking: hasBuiltin,
    }
    // Only set optional fields when they are actually present (exactOptionalPropertyTypes).
    if (r.mappedCategory != null) rule.mappedCategory = r.mappedCategory
    if (hasPredicate && predicate != null) rule.predicate = predicate
    if (r.assertion != null) rule.assertion = r.assertion
    else if (obligationWithCmdSubstr || (push && !hasPredicate && !hasBuiltin))
      rule.assertion = r.text
    return rule
  })
}

/**
 * LUM-780: after the active policy changes, the project's OPEN blocking
 * POLICY_WEAKENING rows are re-judged against the source just read — "is the
 * rule text still in the file" has a fresh answer at exactly this moment.
 * Fail-soft and lazily imported: the re-judge service calls back into this
 * module's reader, and a re-judge failure must never fail a compile.
 */
async function rejudgeAfterPolicyChange(
  projectId: string,
  source: string
): Promise<void> {
  try {
    const { boundaryCrossingRejudgeService } =
      await import('@/lib/services/boundary-crossing-rejudge.service')
    await boundaryCrossingRejudgeService.rejudgePolicyWeakeningForProject({
      projectId,
      source,
    })
  } catch (error) {
    logger.warn(
      `[policy-compiler] POLICY_WEAKENING re-judge failed for project ${projectId}: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}

/**
 * The expensive half of ensureCompiled — model call, safety nets, persist —
 * for a source no row exists for yet. Runs at most once per
 * (projectId, sourceHash) per instance (the in-flight map); across instances
 * the insert-or-ignore decides who owns the row, and only that owner diffs
 * against `prev` for POLICY_WEAKENING.
 */
async function compileAndPersist(
  input: {
    projectId: string
    workspaceId: string
    fullName: string
    taskId?: string
  },
  source: string,
  sourceHash: string,
  prev: { sourceHash: string; rules: PolicyRule[] } | null
): Promise<CompiledPolicy | null> {
  // Classify via LLM (dynamic import so jest.mock intercepts it in tests).
  const { classifyRules } = await import('@/lib/llm/policy-compiler-client')
  let raw: Awaited<ReturnType<typeof classifyRules>>
  try {
    raw = await classifyRules({
      sourceText: source,
      builtinCategories: [...BUILTIN_CATEGORIES],
    })
  } catch {
    // Fail-safe: keep the previous policy so the detector stays live.
    return prev ? { sourceHash: prev.sourceHash, rules: prev.rules } : null
  }

  // Apply the deterministic safety nets (pure; see compileRuleSet).
  const rules = compileRuleSet(raw.rules)

  // Persist — insert-or-ignore on (projectId, sourceHash).
  const inserted = await projectPolicyRepository.createIfAbsent({
    projectId: input.projectId,
    sourceHash,
    rules,
  })
  if (!inserted) {
    // Another instance persisted this source first. Its row is the policy
    // (ours may differ — the model is not deterministic), and it already
    // owns the weakening diff against `prev`; running it again here is how
    // the same removed rule came to be recorded three times (LUM-774).
    const winner = await projectPolicyRepository.findByHash(
      input.projectId,
      sourceHash
    )
    return { sourceHash, rules: winner?.rules ?? rules }
  }

  // Emit POLICY_WEAKENING for removed deterministic+blocking rules — only
  // from the compile that created the row.
  if (prev && input.taskId) {
    await emitWeakening(prev.rules, rules, input.taskId, source)
  }
  await rejudgeAfterPolicyChange(input.projectId, source)
  return { sourceHash, rules }
}

/**
 * The current source was compiled before but is not the active row (the file
 * was edited past it and then reverted, or a race we lost was already
 * persisted). No model call: re-activate the stored row by moving its
 * compiledAt forward — a compare-and-swap, so concurrent re-activators diff
 * `latest → existing` exactly once — and serve its rules.
 */
async function reactivate(
  existing: StoredProjectPolicy,
  latest: { sourceHash: string; rules: PolicyRule[] } | null,
  input: { projectId: string; taskId?: string },
  source: string
): Promise<CompiledPolicy> {
  const won = await projectPolicyRepository.activateIfUnchanged(
    existing.id,
    existing.compiledAt,
    new Date()
  )
  if (won && latest && input.taskId) {
    await emitWeakening(latest.rules, existing.rules, input.taskId, source)
  }
  if (won) await rejudgeAfterPolicyChange(input.projectId, source)
  return { sourceHash: existing.sourceHash, rules: existing.rules }
}

export const policyCompilerService = {
  /**
   * LUM-780: the project's current CLAUDE.md + AGENTS.md source (cached 60 s,
   * installation token) — the state the POLICY_WEAKENING re-judge asks about.
   * Null when neither file exists or the repo is unreadable.
   */
  async readSource(input: {
    projectId: string
    workspaceId: string
    fullName: string
  }): Promise<string | null> {
    return readSource(input.projectId, input.workspaceId, input.fullName)
  },

  /**
   * Returns the active compiled policy for a project, recompiling only when
   * the source hash has changed (or no policy exists yet).
   *
   * When taskId is provided and a previous policy existed, emits
   * POLICY_WEAKENING for any deterministic blocking rules that were removed —
   * once per (projectId, sourceHash), from the caller that persisted the row
   * (LUM-774).
   */
  async ensureCompiled(input: {
    projectId: string
    workspaceId: string
    fullName: string
    taskId?: string
  }): Promise<CompiledPolicy | null> {
    // 1. Read the source files — bail early if absent.
    const source = await readSource(
      input.projectId,
      input.workspaceId,
      input.fullName
    )
    if (source == null) return null

    const sourceHash = createHash('sha256')
      .update(source)
      .update(`\n\u0000compiler:${COMPILER_VERSION}`)
      .digest('hex')

    // 2. Hot path: the active policy was compiled from this very source.
    const latest = await projectPolicyRepository.latestForProject(
      input.projectId
    )
    if (latest && latest.sourceHash === sourceHash) {
      return { sourceHash, rules: latest.rules }
    }

    // 3. Known but inactive source (revert / already-lost race) → re-activate.
    const existing = await projectPolicyRepository.findByHash(
      input.projectId,
      sourceHash
    )
    if (existing) return reactivate(existing, latest, input, source)

    // 4. Never compiled: single-flight the model call + persist per key.
    const key = `${input.projectId}:${sourceHash}`
    const running = _inflight.get(key)
    if (running) return running
    const run = compileAndPersist(input, source, sourceHash, latest).finally(
      () => {
        _inflight.delete(key)
      }
    )
    _inflight.set(key, run)
    return run
  },
}
