/**
 * @jest-environment node
 *
 * LUM-1063 — the installed security plugin registers the boundary-crossing
 * extension points and each one calls the pre-split implementation with the
 * same arguments: the two detectors, the compiled-policy rule source
 * (compile on demand / stored rules / rule text / source reader), the system
 * explainer, and the IN_REVIEW policy check — end to end from
 * `updateTaskWithSideEffects`
 * through the `task.statusChanged` core event.
 */
const dispatchPolicyCheck = jest.fn(async (..._a: unknown[]) => undefined)
jest.mock('@/lib/services/policy/policy-check-dispatch', () => ({
  dispatchPolicyCheck: (...a: unknown[]) => dispatchPolicyCheck(...a),
}))
const ensureCompiled = jest.fn()
const readSource = jest.fn()
jest.mock('@/lib/services/policy/policy-compiler.service', () => ({
  policyCompilerService: {
    ensureCompiled: (...a: unknown[]) => ensureCompiled(...a),
    readSource: (...a: unknown[]) => readSource(...a),
  },
}))
const latestForProject = jest.fn()
const findRuleTextByRef = jest.fn()
jest.mock('@/lib/repositories/project-policy.repository', () => ({
  projectPolicyRepository: {
    latestForProject: (...a: unknown[]) => latestForProject(...a),
    findRuleTextByRef: (...a: unknown[]) => findRuleTextByRef(...a),
  },
}))
const explainLLM = jest.fn()
jest.mock('@/lib/llm/crossing-explain-client', () => ({
  explainCrossing: (...a: unknown[]) => explainLLM(...a),
}))

// updateTask's own deps (same isolation as task-state.done-gate.test.ts).
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: { findSecurityPolicy: jest.fn(async () => null) },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    findManyForSecurityByTaskId: jest.fn(async () => []),
  },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findForUpdate: jest.fn(), update: jest.fn() },
}))
const findDefaultRepository = jest.fn()
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {
    findByIdSimple: jest.fn(),
    findDefaultRepository: (...a: unknown[]) => findDefaultRepository(...a),
  },
}))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { findById: jest.fn() },
}))
jest.mock('@/lib/repositories/tag.repository', () => ({
  tagRepository: {
    findByTask: jest.fn(() => []),
    syncTaskTags: jest.fn(),
    addTaskTags: jest.fn(),
    removeTaskTags: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))
jest.mock('@/lib/repositories/test-case.repository', () => ({
  testCaseRepository: {
    listForTask: jest.fn(async () => []),
    runsPerCase: jest.fn(async () => new Map()),
  },
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    findUndispositionedByTask: jest.fn(async () => []),
    isGateEnabledForWorkspace: jest.fn(async () => true),
  },
}))
// The side-effect fan-out of updateTaskWithSideEffects, kept inert (same as
// task-state-lineage-trigger.test.ts).
jest.mock('@/lib/runtime/wait-until', () => ({ waitUntil: jest.fn() }))
jest.mock('@/lib/services/lineage-outcome.service', () => ({
  lineageOutcomeService: {},
  stampLineageInBackground: jest.fn(),
}))
jest.mock('@/lib/services/memory/layer2.service', () => ({
  layer2Service: { triggerForTaskCompletion: jest.fn() },
}))
jest.mock('@/lib/services/sprint.service', () => ({
  sprintService: { autoAddCompletedTaskToActiveSprint: jest.fn() },
}))
jest.mock('@/lib/services/task-notifications.service', () => ({
  dispatchUpdateTaskSideEffects: jest.fn(),
}))
jest.mock('@/lib/task/state-machine', () => ({
  isValidTaskTransition: () => true,
}))

import { getPluginRegistry } from '@/lib/plugins/registry'
import { crossingExplainer, policyRuleSource } from '@/lib/plugins/crossings'
import { updateTaskWithSideEffects } from '@/lib/services/task-state.service'
import { taskRepository } from '@/lib/repositories/task.repository'

const TASK = {
  id: 't-1',
  status: 'IN_PROGRESS',
  projectId: 'p-1',
  project: { workspaceId: 'w-1' },
  sprintId: null,
  assigneeActorId: null,
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(taskRepository.findForUpdate as jest.Mock).mockResolvedValue({ ...TASK })
})

describe('LUM-1063 security plugin — crossing extension points', () => {
  it('registers both detectors, the rule source, the explainer and the status handler', () => {
    const r = getPluginRegistry()
    expect(r.crossingDetectors.map(d => d.id)).toEqual([
      'security.advanced',
      'security.policy-rules',
    ])
    expect(r.crossingDetectors[0]!.categories).toEqual([
      'DESTRUCTIVE_FS_COMMAND',
      'UNTRUSTED_CODE_EXECUTION',
      'SENSITIVE_PATH_READ',
    ])
    expect(
      r.crossingDetectors[0]!.commandMatchers!.map(m => [m.category, !!m.raw])
    ).toEqual([
      ['DESTRUCTIVE_FS_COMMAND', false],
      ['UNTRUSTED_CODE_EXECUTION', true],
    ])
    expect(r.policyRuleSources.map(s => s.id)).toEqual([
      'security.compiled-policy',
    ])
    expect(r.crossingExplainers.map(e => e.id)).toEqual(['security'])
    expect(r.handlersFor('task.statusChanged')).toHaveLength(1)
  })

  it('compiles the project policy for the hook detector exactly as before', async () => {
    const src = policyRuleSource()!
    findDefaultRepository.mockResolvedValueOnce(null)
    await expect(
      src.rulesForTask({ taskId: 't-1', projectId: 'p-1', workspaceId: 'w-1' })
    ).resolves.toEqual([])
    expect(ensureCompiled).not.toHaveBeenCalled()

    findDefaultRepository.mockResolvedValueOnce({ fullName: 'o/r' })
    ensureCompiled.mockResolvedValueOnce({
      sourceHash: 'h',
      rules: [{ id: 'r' }],
    })
    await expect(
      src.rulesForTask({ taskId: 't-1', projectId: 'p-1', workspaceId: 'w-1' })
    ).resolves.toEqual([{ id: 'r' }])
    expect(findDefaultRepository).toHaveBeenLastCalledWith('p-1')
    expect(ensureCompiled).toHaveBeenCalledWith({
      projectId: 'p-1',
      workspaceId: 'w-1',
      fullName: 'o/r',
      taskId: 't-1',
    })
    ensureCompiled.mockResolvedValueOnce(null)
    findDefaultRepository.mockResolvedValueOnce({ fullName: 'o/r' })
    await expect(
      src.rulesForTask({ taskId: 't-1', projectId: 'p-1', workspaceId: 'w-1' })
    ).resolves.toEqual([])
  })

  it('reads stored rules, rule text and the source through the same repository / compiler calls', async () => {
    const src = policyRuleSource()!
    latestForProject.mockResolvedValueOnce(null)
    await expect(src.storedRules('p-1')).resolves.toBeNull()
    latestForProject.mockResolvedValueOnce({ rules: [{ id: 'r' }] })
    await expect(src.storedRules('p-1')).resolves.toEqual([{ id: 'r' }])
    expect(latestForProject).toHaveBeenCalledWith('p-1')

    findRuleTextByRef.mockResolvedValueOnce('Never x')
    await expect(src.ruleTextByRef('p-1', 'ref')).resolves.toBe('Never x')
    expect(findRuleTextByRef).toHaveBeenCalledWith('p-1', 'ref')

    readSource.mockResolvedValueOnce('## Forbidden')
    const where = { projectId: 'p-1', workspaceId: 'w-1', fullName: 'o/r' }
    await expect(src.readSource(where)).resolves.toBe('## Forbidden')
    expect(readSource).toHaveBeenCalledWith(where)
  })

  it('explains through the crossing-explain LLM client with the same input', async () => {
    const input = {
      rule: null,
      evidence: 'git push origin main',
      category: 'PUSH_TO_PROTECTED_BRANCH' as const,
      severity: 'MEDIUM' as const,
      agentContext: null,
    }
    explainLLM.mockResolvedValueOnce({ explanation: 'because' })
    await expect(crossingExplainer()!.explain(input)).resolves.toEqual({
      explanation: 'because',
    })
    expect(explainLLM).toHaveBeenCalledWith(input)
  })

  it.each([
    ['IN_REVIEW', 1],
    ['TODO', 0],
    ['IN_PROGRESS', 0],
  ])(
    'updateTaskWithSideEffects → %s dispatches the policy check %i time(s)',
    async (status, times) => {
      ;(taskRepository.update as jest.Mock).mockResolvedValue({
        ...TASK,
        status,
        team: { identifier: 'LUM' },
        teamId: 'team-1',
      })
      await updateTaskWithSideEffects(
        't-1',
        { status },
        { project: { workspaceId: 'w-1' } } as never,
        'actor-1',
        'clerk-1'
      )
      expect(dispatchPolicyCheck).toHaveBeenCalledTimes(times)
      if (times) expect(dispatchPolicyCheck).toHaveBeenCalledWith('t-1')
    }
  )
})
