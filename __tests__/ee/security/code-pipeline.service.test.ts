/**
 * @jest-environment node
 *
 * LUM-590 Task 6 — Code-rule pipeline service tests.
 *
 * Mock strategy:
 * - policyCompilerService: jest.mock at module scope (intercepted before import)
 * - github/contents: jest.mock (pure network callers — no static state)
 * - code-rule-judge-client: jest.mock (intercepts the dynamic import inside the
 *   service because jest rewrites the module registry before tests run)
 * - boundaryCrossingRepository: jest.spyOn (imported at module level by the
 *   service; spy captures calls without replacing the whole module)
 */

// LUM-866: every workspace here has the default switches (all on) unless a test
// says otherwise (LUM-892 overrides it below).
jest.mock('@/lib/services/security-workspace-switches.service', () => ({
  // A plain function, not jest.fn: survives resetAllMocks.
  loadSecurityLayers: async () =>
    jest
      .requireActual('@/lib/security-scan/workspace-switches')
      .resolveSecurityLayers(null),
}))

import { codePipelineService } from '@/lib/services/policy/code-pipeline.service'
import * as compiler from '@/lib/services/policy/policy-compiler.service'
import * as gh from '@/lib/integrations/github/contents'
import * as judge from '@/lib/llm/code-rule-judge-client'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'

// ── Module-level mocks ────────────────────────────────────────────────────────

// Prevent @octokit/auth-app ESM parse error (same guard as policy-compiler tests).
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn().mockResolvedValue('test-token'),
}))

jest.mock('@/lib/services/policy/policy-compiler.service')
jest.mock('@/lib/integrations/github/contents')
jest.mock('@/lib/llm/code-rule-judge-client')

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE = {
  taskId: 't1',
  projectId: 'p1',
  workspaceId: 'w1',
  fullName: 'o/r',
  prNumber: 7,
}

// A compiled policy with one deterministic code rule and one semantic code rule.
const COMPILED_POLICY = {
  sourceHash: 'h',
  rules: [
    {
      id: 'c1',
      text: 'no console.log',
      kind: 'code' as const,
      tier: 'deterministic' as const,
      predicate: { type: 'diff-regex' as const, value: 'console\\.log' },
      severity: 'LOW' as const,
      blocking: false,
    },
    {
      id: 's1',
      text: 'use named exports',
      kind: 'code' as const,
      tier: 'semantic' as const,
      assertion: 'use named exports',
      severity: 'LOW' as const,
      blocking: false,
    },
  ],
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks()
  ;(
    compiler.policyCompilerService.ensureCompiled as jest.Mock
  ).mockResolvedValue(COMPILED_POLICY)
})

// ── Tests ─────────────────────────────────────────────────────────────────────

test('diff-regex flags added lines only not pre-existing base lines', async () => {
  const createSpy = jest
    .spyOn(boundaryCrossingRepository, 'create')
    .mockResolvedValue(undefined as never)

  // Diff: one ADDED line with console.log, one REMOVED line with console.log
  // (base). The deterministic rule must only flag the added line, not the base.
  ;(gh.fetchPrDiff as jest.Mock).mockResolvedValue(
    '+++ b/src/a.ts\n+console.log("x")\n const ok = 1\n-console.log("base")'
  )
  // Use the real addedLinesFromDiff implementation so the test is non-vacuous
  // (it actually exercises the "added lines only" parsing logic).
  ;(gh.addedLinesFromDiff as jest.Mock).mockImplementation(
    jest.requireActual('@/lib/integrations/github/contents').addedLinesFromDiff
  )
  ;(judge.judgeCodeRules as jest.Mock).mockResolvedValue({ violations: [] })

  const res = await codePipelineService.runForTask(BASE)

  // Exactly ONE deterministic crossing: the added console.log, not the removed base one.
  expect(res.deterministic).toBe(1)
  expect(createSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      category: 'PROJECT_RULE_VIOLATION',
      advisory: false,
      policyRuleRef: 'c1',
    })
  )
  // The advisory count is zero (judge returned no violations).
  expect(res.advisory).toBe(0)
})

test('semantic judge records advisory and never dispositions and fails closed', async () => {
  const createSpy = jest
    .spyOn(boundaryCrossingRepository, 'create')
    .mockResolvedValue(undefined as never)

  ;(gh.fetchPrDiff as jest.Mock).mockResolvedValue(
    '+++ b/src/a.ts\n+export default foo'
  )
  ;(gh.addedLinesFromDiff as jest.Mock).mockReturnValue([
    { path: 'src/a.ts', addedLines: ['export default foo'] },
  ])

  // Judge fails — triggers the fail-closed path
  ;(judge.judgeCodeRules as jest.Mock).mockRejectedValue(new Error('timeout'))

  const res = await codePipelineService.runForTask(BASE)

  // fail-closed: a semantic advisory crossing must still be recorded
  expect(res.advisory).toBeGreaterThanOrEqual(1)
  expect(createSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      category: 'PROJECT_RULE_VIOLATION',
      advisory: true,
    })
  )

  // CRITICAL: the judge path must NEVER set a disposition field on any create call.
  // Dispositions are human-only (LUM-590 spec). Even AUTO_LEGIT is forbidden here.
  for (const call of createSpy.mock.calls) {
    expect(call[0]).not.toHaveProperty('disposition')
  }
})

test('passes explicit reversible on every create site', async () => {
  // LUM-630: every code-pipeline create must route reversibility through the
  // taxonomy — an omitted field ate the repository's `?? false` default and
  // mislabeled diff-only violations as irreversible. All three sites
  // (deterministic, semantic, judge-unavailable fail-closed) carry a
  // `coderule:` target, so all three must record reversible: true.
  const createSpy = jest
    .spyOn(boundaryCrossingRepository, 'create')
    .mockResolvedValue(undefined as never)

  // Round 1: deterministic hit + semantic violation.
  ;(gh.fetchPrDiff as jest.Mock).mockResolvedValue(
    '+++ b/src/a.ts\n+console.log("x")'
  )
  ;(gh.addedLinesFromDiff as jest.Mock).mockReturnValue([
    { path: 'src/a.ts', addedLines: ['console.log("x")'] },
  ])
  ;(judge.judgeCodeRules as jest.Mock).mockResolvedValue({
    violations: [{ ruleId: 's1', detail: 'default export' }],
  })
  await codePipelineService.runForTask(BASE)

  // Round 2: judge unavailable — the fail-closed create site.
  ;(judge.judgeCodeRules as jest.Mock).mockRejectedValue(new Error('timeout'))
  await codePipelineService.runForTask(BASE)

  expect(createSpy.mock.calls.length).toBeGreaterThanOrEqual(3)
  for (const call of createSpy.mock.calls) {
    expect(call[0]).toHaveProperty('reversible', true)
  }
  // All three distinct sites were exercised (deterministic ×2 runs, semantic,
  // judge-unavailable).
  const targets = createSpy.mock.calls.map(
    c => (c[0] as { target?: string }).target
  )
  expect(targets).toEqual(
    expect.arrayContaining([
      'coderule:c1',
      'coderule:s1',
      'coderule:judge-unavailable',
    ])
  )
})
