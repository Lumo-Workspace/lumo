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
 */
import { createHash } from 'crypto'
import { projectPolicyRepository } from '@/lib/repositories/project-policy.repository'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { isReversible } from '@/lib/services/boundary-detector.service'
import { isObligationText } from './rule-polarity'
import type { CompiledPolicy, PolicyRule } from './types'

/**
 * Part of the policy cache key alongside the source text. Bump it whenever the
 * prompt or the post-processing below changes what a given CLAUDE.md compiles
 * to, so every project recompiles exactly once on its next hook event instead
 * of serving a stale rule set until someone edits the doc (LUM-770: the stored
 * policies carried the tsc-obligation-as-prohibition rule).
 */
const COMPILER_VERSION = 'lum770'

// ── In-memory source cache ────────────────────────────────────────────────────
// Avoids 2 GitHub API reads on every PostToolUse event (ensureCompiled hot path).
// TTL = 60 s; the downstream sha256 hash check catches stale-but-different source.
const SOURCE_CACHE_TTL_MS = 60_000
const _sourceCache = new Map<string, { source: string | null; at: number }>()

/** Exported only for test teardown — do not call in production code. */
export function __resetSourceCache(): void {
  _sourceCache.clear()
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
 * Markdown-insensitive comparison basis. A rule's `text` is what the classifier
 * extracted, with emphasis and code spans already stripped; the source still
 * carries them, so `source.includes(rule.text)` is false for a rule that is
 * plainly still there. Normalising both sides is what makes "is this text still
 * in the file" a question worth asking.
 */
function normalizeForPresence(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
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
  const haystack = normalizeForPresence(source)
  for (const r of weakened) {
    const stillInSource = haystack.includes(normalizeForPresence(r.text))
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
    })
  }
}

export const policyCompilerService = {
  /**
   * Returns the active compiled policy for a project, recompiling only when
   * the source hash has changed (or no policy exists yet).
   *
   * When taskId is provided and a previous policy existed, emits
   * POLICY_WEAKENING for any deterministic blocking rules that were removed.
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

    // 2. Check cache: if the hash matches the latest stored policy, reuse it.
    const prev = await projectPolicyRepository.latestForProject(input.projectId)
    if (prev && prev.sourceHash === sourceHash) {
      return { sourceHash, rules: prev.rules }
    }

    // 3. Classify via LLM (dynamic import so jest.mock intercepts it in tests).
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

    // 4. Apply safety-net: a deterministic rule with neither a known built-in
    //    category nor a safe predicate is downgraded to semantic tier.
    //    LUM-770: an OBLIGATION carrying a cmd-substr predicate ("tests +
    //    `npx tsc --noEmit` pass" before a PR) is downgraded too, and loses
    //    the predicate — the detector reads cmd-substr as "running this is a
    //    violation", which inverts a must-do. Either the model's own polarity
    //    or the wording guard is enough; the guard exists because the model
    //    misreading the sentence is the failure being fixed.
    const rules: PolicyRule[] = raw.rules.map(r => {
      const hasBuiltin =
        r.mappedCategory != null &&
        (BUILTIN_CATEGORIES as readonly string[]).includes(r.mappedCategory)
      const obligationWithCmdSubstr =
        r.kind === 'action' &&
        r.predicate?.type === 'cmd-substr' &&
        (r.polarity === 'require' || isObligationText(r.text))
      const hasPredicate = r.predicate != null && !obligationWithCmdSubstr

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
      if (hasPredicate && r.predicate != null) rule.predicate = r.predicate
      if (r.assertion != null) rule.assertion = r.assertion
      else if (obligationWithCmdSubstr) rule.assertion = r.text
      return rule
    })

    // 5. Persist the new policy snapshot.
    await projectPolicyRepository.create({
      projectId: input.projectId,
      sourceHash,
      rules,
    })

    // 6. Emit POLICY_WEAKENING for removed deterministic+blocking rules.
    if (prev && input.taskId) {
      await emitWeakening(prev.rules, rules, input.taskId, source)
    }

    return { sourceHash, rules }
  },
}
