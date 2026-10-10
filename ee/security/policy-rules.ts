/**
 * LUM-1063 — the security plugin's project policy rule source (LUM-590): the
 * CLAUDE.md / AGENTS.md rules the LLM policy compiler classifies and stores in
 * `ProjectPolicy` (a plugin table, RFC §4 option A). Registered on the core's
 * `policyRuleSource` extension point by `./server.ts`.
 *
 * Everything is imported lazily: the compiler reaches the GitHub contents
 * client and, on a recompile, the model; the repository reaches Prisma. None
 * of it belongs on the static graph of the modules that read the registry.
 */
import type { PolicyRuleSource } from '@/lib/plugins/crossing-types'

export const compiledPolicyRuleSource: PolicyRuleSource = {
  id: 'security.compiled-policy',

  /**
   * The hook detector's rules: compile on demand (hash-cached, single-flight;
   * may emit POLICY_WEAKENING through the core judge). A project without a
   * default linked repository has no policy.
   */
  async rulesForTask({ taskId, projectId, workspaceId }) {
    const { projectRepository } =
      await import('@/lib/repositories/project.repository')
    const defaultRepo = await projectRepository.findDefaultRepository(projectId)
    if (!defaultRepo) return []
    const { policyCompilerService } =
      await import('@/lib/services/policy/policy-compiler.service')
    const compiled = await policyCompilerService.ensureCompiled({
      projectId,
      workspaceId,
      fullName: defaultRepo.fullName,
      taskId,
    })
    return compiled?.rules ?? []
  },

  /** LUM-793: the memory write gate reads the stored policy, never compiles. */
  async storedRules(projectId) {
    const { projectPolicyRepository } =
      await import('@/lib/repositories/project-policy.repository')
    const policy = await projectPolicyRepository.latestForProject(projectId)
    return policy ? policy.rules : null
  },

  /** LUM-780: rows written before `policyRuleText` was stamped. */
  async ruleTextByRef(projectId, ruleRef) {
    const { projectPolicyRepository } =
      await import('@/lib/repositories/project-policy.repository')
    return projectPolicyRepository.findRuleTextByRef(projectId, ruleRef)
  },

  /** The compiler's own reader (cached 60 s, installation token). */
  async readSource(input) {
    const { policyCompilerService } =
      await import('@/lib/services/policy/policy-compiler.service')
    return policyCompilerService.readSource(input)
  },
}
