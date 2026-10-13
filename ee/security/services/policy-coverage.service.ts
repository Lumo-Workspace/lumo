/**
 * LUM-1114 — which of a workspace's project rules are NOT checked
 * automatically, so the settings page can say so instead of letting a team
 * believe every line of its CLAUDE.md / AGENTS.md is enforced.
 *
 * A rule is unchecked when no detector consumes its compiled shape
 * (rule-reachability: today every behavioural rule that needs judgement), or
 * when it is a code rule only the AI judge reads and the workspace has
 * security scanning or AI review switched off (code-pipeline skips the judge
 * then). Tenant-scoped: only the caller's own workspace is read.
 */
import { projectPolicyRepository } from '@/ee/security/repositories/project-policy.repository'
import { loadSecurityLayers } from '@/ee/security/services/security-workspace-switches.service'
import { BUILTIN_CATEGORIES } from '@/ee/security/services/policy/policy-compiler.service'
import { ruleReach } from '@/ee/security/services/policy/rule-reachability'
import type { PolicyRule } from '@/ee/security/services/policy/types'

export type UncheckedReason = 'NO_CHECKER' | 'AI_REVIEW_OFF'

export interface UncheckedRule {
  ruleId: string
  text: string
  kind: PolicyRule['kind']
  reason: UncheckedReason
}

export interface ProjectPolicyCoverage {
  projectId: string
  projectName: string
  /** ISO time of the active compile; null = the rules were never compiled. */
  compiledAt: string | null
  totalRules: number
  unchecked: UncheckedRule[]
}

export interface PolicyCoverage {
  projects: ProjectPolicyCoverage[]
}

const BUILTINS: ReadonlySet<string> = new Set(BUILTIN_CATEGORIES)

/** The unchecked rules of one compiled policy. Pure. */
export function uncheckedRules(
  rules: readonly PolicyRule[],
  opts: { aiJudgeRuns: boolean }
): UncheckedRule[] {
  const out: UncheckedRule[] = []
  for (const r of rules) {
    const reach = ruleReach(r, BUILTINS)
    const reason: UncheckedReason | null =
      reach === 'unchecked'
        ? 'NO_CHECKER'
        : reach === 'code-judge' && !opts.aiJudgeRuns
          ? 'AI_REVIEW_OFF'
          : null
    if (reason) out.push({ ruleId: r.id, text: r.text, kind: r.kind, reason })
  }
  return out
}

export const policyCoverageService = {
  async get(caller: { workspaceId: string }): Promise<PolicyCoverage> {
    const [projects, layers] = await Promise.all([
      projectPolicyRepository.activePoliciesForWorkspace(caller.workspaceId),
      loadSecurityLayers(caller.workspaceId),
    ])
    const aiJudgeRuns = layers.scan && layers.aiReview
    return {
      projects: projects.map(p => ({
        projectId: p.projectId,
        projectName: p.projectName,
        compiledAt: p.policy?.compiledAt.toISOString() ?? null,
        totalRules: p.policy?.rules.length ?? 0,
        unchecked: p.policy
          ? uncheckedRules(p.policy.rules, { aiJudgeRuns })
          : [],
      })),
    }
  },
}
