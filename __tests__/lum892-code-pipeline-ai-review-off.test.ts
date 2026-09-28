/**
 * @jest-environment node
 *
 * LUM-892 — the policy code-rule pipeline's semantic judge sends the whole PR
 * diff to a model, which is what the workspace's AI review switch promises to
 * stop (user ruling: the semantic judge is governed by that switch). With AI
 * review off: no model call, one advisory crossing saying the semantic rules
 * were not checked and why (advisory never blocks DONE), and the
 * deterministic diff-regex rules still run.
 *
 * Real: the pipeline, the switch loader and resolver, the added-line parser.
 * Mocked: the compiled policy, the workspace row, GitHub, the model client.
 */
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn().mockResolvedValue('test-token'),
}))
jest.mock('@/lib/services/policy/policy-compiler.service')
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrDiff: jest.fn(),
  addedLinesFromDiff: jest.requireActual('@/lib/integrations/github/contents')
    .addedLinesFromDiff,
}))
jest.mock('@/lib/llm/code-rule-judge-client')
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: { findSecuritySwitches: jest.fn() },
}))

import { codePipelineService } from '@/lib/services/policy/code-pipeline.service'
import * as compiler from '@/lib/services/policy/policy-compiler.service'
import * as gh from '@/lib/integrations/github/contents'
import * as judge from '@/lib/llm/code-rule-judge-client'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'

const BASE = {
  taskId: 't1',
  projectId: 'p1',
  workspaceId: 'w1',
  fullName: 'o/r',
  prNumber: 7,
}
const DETERMINISTIC = {
  id: 'c1',
  text: 'no console.log',
  kind: 'code' as const,
  tier: 'deterministic' as const,
  predicate: { type: 'diff-regex' as const, value: 'console\\.log' },
  severity: 'LOW' as const,
  blocking: false,
}
const SEMANTIC = {
  id: 's1',
  text: 'use named exports',
  kind: 'code' as const,
  tier: 'semantic' as const,
  assertion: 'use named exports',
  severity: 'LOW' as const,
  blocking: false,
}
const ALL_ON = {
  securityScanEnabled: true,
  securityAiReviewEnabled: true,
  securityHuntEnabled: true,
}
const switches = workspaceRepository.findSecuritySwitches as jest.Mock
const ensureCompiled = compiler.policyCompilerService
  .ensureCompiled as jest.Mock
const judgeCodeRules = judge.judgeCodeRules as jest.Mock
let create: jest.SpyInstance

beforeEach(() => {
  jest.clearAllMocks()
  create = jest
    .spyOn(boundaryCrossingRepository, 'create')
    .mockResolvedValue(undefined as never)
  ensureCompiled.mockResolvedValue({
    sourceHash: 'h',
    rules: [DETERMINISTIC, SEMANTIC],
  })
  ;(gh.fetchPrDiff as jest.Mock).mockResolvedValue(
    '+++ b/src/a.ts\n+console.log("x")\n+export default foo'
  )
  judgeCodeRules.mockResolvedValue({
    violations: [{ ruleId: 's1', detail: 'default export' }],
  })
  switches.mockResolvedValue({ ...ALL_ON, securityAiReviewEnabled: false })
})

describe('LUM-892 semantic code rules', () => {
  it('LUM-892 semantic code rules: AI review off makes no model call and records one advisory not-checked crossing', async () => {
    const res = await codePipelineService.runForTask(BASE)
    expect(judgeCodeRules).not.toHaveBeenCalled()
    expect(switches).toHaveBeenCalledWith('w1')
    expect(res).toEqual({ deterministic: 1, advisory: 1 })
    const advisory = create.mock.calls
      .map(c => c[0])
      .filter(c => c.advisory === true)
    expect(advisory).toEqual([
      expect.objectContaining({
        taskId: 't1',
        category: 'PROJECT_RULE_VIOLATION',
        target: 'coderule:ai-review-off',
        detail: expect.stringContaining(
          "AI review is turned off in this workspace's settings"
        ),
      }),
    ])
    // The deterministic rule still ran and still blocks as before.
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ policyRuleRef: 'c1', advisory: false })
    )
  })

  it('LUM-892 semantic code rules: scanning turned off entirely also keeps the diff away from the model', async () => {
    switches.mockResolvedValue({ ...ALL_ON, securityScanEnabled: false })
    await codePipelineService.runForTask(BASE)
    expect(judgeCodeRules).not.toHaveBeenCalled()
  })

  it('LUM-892 semantic code rules: control, with AI review on the judge runs as before', async () => {
    switches.mockResolvedValue(ALL_ON)
    const res = await codePipelineService.runForTask(BASE)
    expect(judgeCodeRules).toHaveBeenCalledTimes(1)
    expect(res).toEqual({ deterministic: 1, advisory: 1 })
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ policyRuleRef: 's1', advisory: true })
    )
  })

  it('LUM-892 semantic code rules: no semantic rule means no switch read and no notice', async () => {
    ensureCompiled.mockResolvedValue({
      sourceHash: 'h',
      rules: [DETERMINISTIC],
    })
    const res = await codePipelineService.runForTask(BASE)
    expect(switches).not.toHaveBeenCalled()
    expect(res).toEqual({ deterministic: 1, advisory: 0 })
  })
})
