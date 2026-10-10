/**
 * @jest-environment node
 *
 * LUM-901 — the code-rule pipeline's "semantic rules not checked" advisory
 * crossing names the switch that is actually off (the master scan switch is
 * not "AI review is turned off"), and a re-run on the same task bumps the
 * open crossing instead of adding another row.
 *
 * Real: the pipeline, the switch resolver, the boundary-crossing repository
 * (over a mocked prisma). Mocked: the compiled policy, GitHub, the model.
 */
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn().mockResolvedValue('test-token'),
}))
jest.mock('@/ee/security/services/policy/policy-compiler.service')
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrDiff: jest.fn(),
  addedLinesFromDiff: jest.requireActual('@/lib/integrations/github/contents')
    .addedLinesFromDiff,
}))
jest.mock('@/ee/security/llm/code-rule-judge-client')
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: {},
}))
jest.mock('@/ee/security/repositories/security-columns.repository', () => ({
  securityColumnsRepository: {
    findSecuritySwitches: jest.fn(),
  },
}))

jest.mock('@/lib/db/prisma', () => {
  const client: Record<string, unknown> = {
    boundaryCrossing: { updateMany: jest.fn(), create: jest.fn() },
    // LUM-1059: create allocates the crossing number in a transaction.
    task: { findUnique: jest.fn(async () => ({ workspaceId: 'w1' })) },
    workspace: { update: jest.fn(async () => ({ crossingSeq: 1 })) },
  }
  client.$transaction = (fn: (tx: unknown) => unknown) => fn(client)
  return { prisma: client }
})

import {
  codePipelineService,
  semanticRulesOffReason,
} from '@/ee/security/services/policy/code-pipeline.service'
import * as compiler from '@/ee/security/services/policy/policy-compiler.service'
import * as gh from '@/lib/integrations/github/contents'
import * as judge from '@/ee/security/llm/code-rule-judge-client'
import { prisma } from '@/lib/db/prisma'
import { securityColumnsRepository } from '@/ee/security/repositories/security-columns.repository'

const BASE = {
  taskId: 't1',
  projectId: 'p1',
  workspaceId: 'w1',
  fullName: 'o/r',
  prNumber: 7,
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
const switches = securityColumnsRepository.findSecuritySwitches as jest.Mock
const db = (
  prisma as unknown as {
    boundaryCrossing: { updateMany: jest.Mock; create: jest.Mock }
  }
).boundaryCrossing

/** An in-memory table of open crossings behind the real repository. */
let rows: { target: string; detail: string; occurrenceCount: number }[]

beforeEach(() => {
  jest.clearAllMocks()
  rows = []
  db.create.mockImplementation(async ({ data }) => {
    rows.push({ target: data.target, detail: data.detail, occurrenceCount: 1 })
    return { id: `bc${rows.length}`, ...data }
  })
  db.updateMany.mockImplementation(async ({ where }) => {
    const open = rows.filter(r => r.target === where.target)
    for (const r of open) r.occurrenceCount += 1
    return { count: open.length }
  })
  ;(
    compiler.policyCompilerService.ensureCompiled as jest.Mock
  ).mockResolvedValue({ sourceHash: 'h', rules: [SEMANTIC] })
  ;(gh.fetchPrDiff as jest.Mock).mockResolvedValue(
    '+++ b/src/a.ts\n+export default foo'
  )
})

describe('LUM-901 code-pipeline off crossing names the right switch and is deduplicated', () => {
  it('master switch off: the crossing says scanning is off, not AI review', async () => {
    switches.mockResolvedValue({
      securityScanEnabled: false,
      securityAiReviewEnabled: true,
    })
    await codePipelineService.runForTask(BASE)
    expect(judge.judgeCodeRules).not.toHaveBeenCalled()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.target).toBe('coderule:scanning-off')
    expect(rows[0]!.detail).toMatch(/security scanning is turned off/)
    expect(rows[0]!.detail).not.toMatch(/AI review/)
  })

  it('AI review off (scan on): the crossing still says AI review', () => {
    expect(semanticRulesOffReason({ scan: true, aiReview: false })).toEqual({
      target: 'coderule:ai-review-off',
      detail: expect.stringContaining('AI review is turned off'),
    })
    expect(semanticRulesOffReason({ scan: true, aiReview: true })).toBeNull()
  })

  it('three runs on the same task leave one open crossing with three occurrences', async () => {
    switches.mockResolvedValue({ securityAiReviewEnabled: false })
    const results = []
    for (let i = 0; i < 3; i++)
      results.push(await codePipelineService.runForTask(BASE))

    expect(db.create).toHaveBeenCalledTimes(1)
    expect(rows).toEqual([
      expect.objectContaining({
        target: 'coderule:ai-review-off',
        occurrenceCount: 3,
      }),
    ])
    // Only the first run created a crossing.
    expect(results.map(r => r.advisory)).toEqual([1, 0, 0])
    // The coalesce stays on the advisory side of the line (LUM-779).
    expect(db.updateMany.mock.calls[0]![0].where).toMatchObject({
      taskId: 't1',
      category: 'PROJECT_RULE_VIOLATION',
      disposition: null,
      advisory: true,
    })
  })
})
