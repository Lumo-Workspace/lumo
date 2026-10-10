/**
 * LUM-793 — the compiled-policy half of the memory write gate.
 *
 * The write path reads the project's ALREADY-compiled policy (LUM-590) and
 * never triggers a compile: compilation reads CLAUDE.md / AGENTS.md over the
 * GitHub installation token and may call the model, which has no business
 * sitting inside `POST /api/projects/[id]/memories`. A project with no
 * compiled policy yet simply contributes no conflict rules — the injection
 * and directive checks are unaffected, and they are the ones that matter for
 * an untrusted write.
 *
 * LUM-1063: the stored policy is read through the core's `policyRuleSource`
 * extension point (the security plugin's compiled ProjectPolicy).
 *
 * Fail-open is deliberate and scoped: a policy read that throws must not turn
 * a legitimate `lumo project memory add` into a 500. The two content checks
 * still run.
 */
import { policyRuleSource } from '@/lib/plugins/crossings'
import { logger } from '@/lib/logger'
import {
  formatMemoryRejection,
  screenMemoryWrite,
  type PolicyRuleRef,
} from '@/lib/memory/poison-gate'
import type { ContentSignals } from '@/shared/src/untrusted-content'
import type { MemoryCategory } from '@prisma/client'

export async function loadPolicyRulesForProject(
  projectId: string
): Promise<PolicyRuleRef[]> {
  // LUM-1063: the compiled policy is a plugin's (`policyRuleSource`); without
  // one there are no rules and the conflict check contributes nothing.
  const source = policyRuleSource()
  if (!source) return []
  try {
    const rules = await source.storedRules(projectId)
    if (!rules) return []
    return rules.map(r => ({
      id: r.id,
      text: r.text,
      tier: r.tier,
      blocking: r.blocking,
      predicate: r.predicate,
    }))
  } catch (err) {
    logger.warn(
      `[memory.poison-gate] policy read failed for project=${projectId} — conflict check skipped:`,
      err instanceof Error ? err.message : err
    )
    return []
  }
}

/**
 * A project's poison gate with its policy rules already loaded — one DB read
 * per apply batch instead of one per operation.
 *
 * The SYSTEM write paths (Layer-1 / Layer-2 curation, milestone distillation,
 * the fold pass) use this rather than the throwing helper the manual paths
 * use: an LLM batch is many operations, and one poisoned candidate must drop
 * that candidate, not abort the batch. Each caller counts the drop as a
 * `skipped` op, which is exactly how they already treat content that fails
 * the per-category Zod schema.
 */
export interface MemoryWriteGate {
  screen(
    category: MemoryCategory,
    content: unknown
  ):
    | { ok: true; signals: ContentSignals | null }
    | { ok: false; message: string }
}

export async function loadMemoryWriteGate(
  projectId: string
): Promise<MemoryWriteGate> {
  const policyRules = await loadPolicyRulesForProject(projectId)
  return {
    screen(category, content) {
      const verdict = screenMemoryWrite({ category, content, policyRules })
      return verdict.ok
        ? { ok: true, signals: verdict.signals }
        : { ok: false, message: formatMemoryRejection(verdict) }
    },
  }
}
