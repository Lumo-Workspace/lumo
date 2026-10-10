/**
 * @jest-environment node
 *
 * LUM-780 — the re-judge service driven through the real orchestration with
 * mocked repositories: which rows it reads, what it writes for each verdict,
 * and — the invariants the task's red lines are made of — that STILL_HOLDS
 * and UNDECIDABLE write nothing, that a 0-row guarded update leaves no trail,
 * and that no write path ever carries a disposition.
 */
// LUM-1064: core-only (the rule source is a fake test plugin); no plugin cases.
const findOpen = jest.fn()
const downgrade = jest.fn()
const createActivity = jest.fn()
const findRuleText = jest.fn()
const findDefaultRepo = jest.fn()
const listPrs = jest.fn()
const fetchPrFiles = jest.fn()
const readSourceViaCompiler = jest.fn()
const warn = jest.fn()

jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    findOpenBlockingRejudgeable: (...a: unknown[]) => findOpen(...a),
    downgradeToAdvisory: (...a: unknown[]) => downgrade(...a),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: (...a: unknown[]) => createActivity(...a) },
}))
// LUM-1063/1064: the stored rule text and the CLAUDE.md source come from the
// `policyRuleSource` extension point. A fake test plugin stands in for it
// (the core runs with no real plugin installed): `findRuleText` is its
// `ruleTextByRef`, `readSourceViaCompiler` its `readSource`.
jest.mock('@/lib/plugins/installed', () => ({
  INSTALLED_SERVER_PLUGINS: [
    {
      id: 'test-policy-rules',
      register(api: PluginRegistrar) {
        api.policyRuleSource({
          id: 'test-policy-rules',
          rulesForTask: async () => [],
          storedRules: async () => null,
          ruleTextByRef: (...a: unknown[]) => findRuleText(...a),
          readSource: (...a: unknown[]) => readSourceViaCompiler(...a),
        })
      },
    },
  ],
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {
    findDefaultRepository: (...a: unknown[]) => findDefaultRepo(...a),
  },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    listRepoAndNumberByTask: (...a: unknown[]) => listPrs(...a),
  },
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrFiles: (...a: unknown[]) => fetchPrFiles(...a),
}))
jest.mock('@/lib/logger', () => ({
  logger: {
    warn: (...a: unknown[]) => warn(...a),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}))

import type { PluginRegistrar } from '@/lib/plugins/types'
import { boundaryCrossingRejudgeService } from '@/lib/services/boundary-crossing-rejudge.service'

const SOURCE = `## Forbidden\n- Never delete files in prisma/migrations/\n`
const task = { projectId: 'p1', project: { workspaceId: 'w1' } }

function policyRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'pw1',
    taskId: 't1',
    category: 'POLICY_WEAKENING',
    severity: 'HIGH',
    detail:
      'A deterministic Forbidden rule was removed from CLAUDE.md: "Never delete files in prisma/migrations/"',
    policyRuleRef: 'abcd',
    policyRuleText: 'Never delete files in prisma/migrations/',
    task,
    ...over,
  }
}
function testRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'tf1',
    taskId: 't1',
    category: 'TEST_FILE_DELETED',
    severity: 'MEDIUM',
    detail: 'rm -f __tests__/zz-probe.test.ts; git status',
    policyRuleRef: null,
    policyRuleText: null,
    task,
    ...over,
  }
}

beforeEach(() => {
  findOpen.mockReset().mockResolvedValue([])
  downgrade.mockReset().mockResolvedValue(1)
  createActivity.mockReset().mockResolvedValue({})
  findRuleText.mockReset().mockResolvedValue(null)
  findDefaultRepo.mockReset().mockResolvedValue({ fullName: 'o/r' })
  listPrs.mockReset().mockResolvedValue([])
  fetchPrFiles.mockReset().mockResolvedValue([])
  readSourceViaCompiler.mockReset().mockResolvedValue(SOURCE)
  warn.mockReset()
})

describe('rejudgePolicyWeakeningForProject (compile trigger)', () => {
  it("reads only that project's POLICY_WEAKENING rows and downgrades one whose rule text is still in the source, with a SYSTEM trail", async () => {
    findOpen.mockResolvedValue([policyRow()])
    const s =
      await boundaryCrossingRejudgeService.rejudgePolicyWeakeningForProject({
        projectId: 'p1',
        source: SOURCE,
      })
    expect(findOpen).toHaveBeenCalledWith({
      categories: ['POLICY_WEAKENING'],
      projectId: 'p1',
      take: 200,
    })
    // The source the compiler just read is used — no second read.
    expect(findDefaultRepo).not.toHaveBeenCalled()
    expect(readSourceViaCompiler).not.toHaveBeenCalled()
    expect(downgrade).toHaveBeenCalledTimes(1)
    const [id, write] = downgrade.mock.calls[0] as [
      string,
      { severity: string; detail: string; now: Date },
    ]
    expect(id).toBe('pw1')
    expect(write.severity).toBe('MEDIUM')
    expect(write.detail).toContain('UNCHANGED in CLAUDE.md')
    expect(write.now).toBeInstanceOf(Date)
    expect(Object.keys(write)).toEqual(['severity', 'detail', 'now'])
    expect(createActivity).toHaveBeenCalledTimes(1)
    expect(createActivity.mock.calls[0]?.[0]).toEqual({
      taskId: 't1',
      actorId: null,
      type: 'BOUNDARY_CROSSING_REJUDGED',
      payload: {
        boundaryCrossingId: 'pw1',
        category: 'POLICY_WEAKENING',
        from: { severity: 'HIGH', advisory: false },
        to: { severity: 'MEDIUM', advisory: true },
        reason: 'RULE_TEXT_PRESENT',
        evidence: expect.stringContaining('still in the current'),
        criterionVersion: 'lum770-text-presence',
        channel: 'SYSTEM',
      },
    })
    expect(s).toMatchObject({
      judged: 1,
      downgraded: 1,
      stillHolds: 0,
      undecidable: 0,
      errors: 0,
      byReason: { RULE_TEXT_PRESENT: 1 },
    })
    expect(s.decisions[0]).toMatchObject({ id: 'pw1', written: true })
  })

  it('writes nothing when the rule text really left the source (STILL_HOLDS)', async () => {
    findOpen.mockResolvedValue([
      policyRow({ policyRuleText: 'Never push to main or develop directly' }),
    ])
    const s =
      await boundaryCrossingRejudgeService.rejudgePolicyWeakeningForProject({
        projectId: 'p1',
        source: SOURCE,
      })
    expect(downgrade).not.toHaveBeenCalled()
    expect(createActivity).not.toHaveBeenCalled()
    expect(s).toMatchObject({ judged: 1, downgraded: 0, stillHolds: 1 })
    expect(s.decisions[0]).toMatchObject({
      reason: 'RULE_TEXT_ABSENT',
      written: false,
    })
  })

  it('recovers the rule text by ref from the stored policies when the row has none', async () => {
    findOpen.mockResolvedValue([
      policyRow({
        policyRuleText: null,
        detail:
          'A deterministic Forbidden rule was removed from CLAUDE.md: "trunc…',
      }),
    ])
    findRuleText.mockResolvedValue('Never delete files in prisma/migrations/')
    const s =
      await boundaryCrossingRejudgeService.rejudgePolicyWeakeningForProject({
        projectId: 'p1',
        source: SOURCE,
      })
    expect(findRuleText).toHaveBeenCalledWith('p1', 'abcd')
    expect(s.downgraded).toBe(1)
  })

  it('leaves the row untouched (no trail) when the guarded update matched 0 rows — a human ruled in between', async () => {
    findOpen.mockResolvedValue([policyRow()])
    downgrade.mockResolvedValue(0)
    const s =
      await boundaryCrossingRejudgeService.rejudgePolicyWeakeningForProject({
        projectId: 'p1',
        source: SOURCE,
      })
    expect(createActivity).not.toHaveBeenCalled()
    expect(s.downgraded).toBe(0)
    expect(s.decisions[0]).toMatchObject({
      outcome: 'CAUSE_GONE',
      written: false,
    })
  })
})

describe('rejudgeTestFileDeletedForTask (PR-close trigger)', () => {
  it("reads only that task's TEST_FILE_DELETED rows and downgrades when no linked PR removes a tracked test file", async () => {
    findOpen.mockResolvedValue([testRow()])
    listPrs.mockResolvedValue([
      { workspaceId: 'w1', repo: 'o/r', number: 990, state: 'merged' },
      { workspaceId: 'w1', repo: 'o/r', number: 991, state: 'open' },
    ])
    fetchPrFiles.mockResolvedValue([
      { filename: '__tests__/a.test.ts', status: 'added' },
    ])
    const s =
      await boundaryCrossingRejudgeService.rejudgeTestFileDeletedForTask('t1')
    expect(findOpen).toHaveBeenCalledWith({
      categories: ['TEST_FILE_DELETED'],
      taskId: 't1',
      take: 200,
    })
    expect(fetchPrFiles).toHaveBeenCalledTimes(2)
    expect(fetchPrFiles).toHaveBeenCalledWith({
      workspaceId: 'w1',
      fullName: 'o/r',
      prNumber: 990,
    })
    expect(downgrade).toHaveBeenCalledWith('tf1', {
      severity: 'MEDIUM',
      detail: expect.stringContaining('re-judged against PR #990, #991'),
      now: expect.any(Date),
    })
    expect(createActivity.mock.calls[0]?.[0]).toMatchObject({
      type: 'BOUNDARY_CROSSING_REJUDGED',
      payload: {
        reason: 'NO_TEST_FILE_REMOVED',
        criterionVersion: 'lum779-net-deletion',
        channel: 'SYSTEM',
        to: { severity: 'MEDIUM', advisory: true },
      },
    })
    expect(s).toMatchObject({ judged: 1, downgraded: 1 })
  })

  it("reads each PR's file list once per pass even with several rows on the task", async () => {
    findOpen.mockResolvedValue([testRow(), testRow({ id: 'tf2' })])
    listPrs.mockResolvedValue([
      { workspaceId: 'w1', repo: 'o/r', number: 990, state: 'merged' },
    ])
    await boundaryCrossingRejudgeService.rejudgeTestFileDeletedForTask('t1')
    expect(listPrs).toHaveBeenCalledTimes(1)
    expect(fetchPrFiles).toHaveBeenCalledTimes(1)
    expect(downgrade).toHaveBeenCalledTimes(2)
  })

  it('writes nothing with no linked PR (UNDECIDABLE)', async () => {
    findOpen.mockResolvedValue([testRow()])
    const s =
      await boundaryCrossingRejudgeService.rejudgeTestFileDeletedForTask('t1')
    expect(downgrade).not.toHaveBeenCalled()
    expect(createActivity).not.toHaveBeenCalled()
    expect(s).toMatchObject({ undecidable: 1, byReason: { NO_LINKED_PR: 1 } })
  })

  it('writes nothing when a PR file list is unreadable (fetch threw) — warned, not guessed', async () => {
    findOpen.mockResolvedValue([testRow()])
    listPrs.mockResolvedValue([
      { workspaceId: 'w1', repo: 'o/r', number: 990, state: 'merged' },
    ])
    fetchPrFiles.mockRejectedValue(new Error('GitHub API error 502'))
    const s =
      await boundaryCrossingRejudgeService.rejudgeTestFileDeletedForTask('t1')
    expect(downgrade).not.toHaveBeenCalled()
    expect(s).toMatchObject({
      undecidable: 1,
      byReason: { PR_FILES_UNREADABLE: 1 },
      errors: 0,
    })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('#990'))
  })

  it('writes nothing when a linked PR really removes a tracked test file (STILL_HOLDS)', async () => {
    findOpen.mockResolvedValue([testRow()])
    listPrs.mockResolvedValue([
      { workspaceId: 'w1', repo: 'o/r', number: 990, state: 'merged' },
    ])
    fetchPrFiles.mockResolvedValue([
      { filename: '__tests__/gone.test.ts', status: 'removed' },
    ])
    const s =
      await boundaryCrossingRejudgeService.rejudgeTestFileDeletedForTask('t1')
    expect(downgrade).not.toHaveBeenCalled()
    expect(s).toMatchObject({
      stillHolds: 1,
      byReason: { TEST_FILE_REMOVED_IN_PR: 1 },
    })
    expect(s.decisions[0]?.evidence).toContain(
      '__tests__/gone.test.ts (PR #990)'
    )
  })

  it('never re-judges an evasion-decoded row, even with clean PRs', async () => {
    findOpen.mockResolvedValue([
      testRow({ detail: '[base64-decoded] rm -rf __tests__' }),
    ])
    listPrs.mockResolvedValue([
      { workspaceId: 'w1', repo: 'o/r', number: 990, state: 'merged' },
    ])
    const s =
      await boundaryCrossingRejudgeService.rejudgeTestFileDeletedForTask('t1')
    expect(downgrade).not.toHaveBeenCalled()
    expect(s.byReason).toEqual({ EVASION_DECODED: 1 })
  })
})

describe('sweep (cron / script)', () => {
  it('reads both categories capped by limit, reads a project source once via the compiler, and judges each row', async () => {
    findOpen.mockResolvedValue([
      policyRow(),
      policyRow({ id: 'pw2' }),
      testRow(),
    ])
    const s = await boundaryCrossingRejudgeService.sweep({ limit: 50 })
    expect(findOpen).toHaveBeenCalledWith({
      categories: ['POLICY_WEAKENING', 'TEST_FILE_DELETED'],
      take: 50,
    })
    expect(findDefaultRepo).toHaveBeenCalledTimes(1)
    expect(readSourceViaCompiler).toHaveBeenCalledTimes(1)
    expect(readSourceViaCompiler).toHaveBeenCalledWith({
      projectId: 'p1',
      workspaceId: 'w1',
      fullName: 'o/r',
    })
    expect(s).toMatchObject({ judged: 3, downgraded: 2, undecidable: 1 })
  })

  it('dryRun judges and reports but writes nothing', async () => {
    findOpen.mockResolvedValue([policyRow()])
    const s = await boundaryCrossingRejudgeService.sweep({ dryRun: true })
    expect(downgrade).not.toHaveBeenCalled()
    expect(createActivity).not.toHaveBeenCalled()
    expect(s.decisions[0]).toMatchObject({
      outcome: 'CAUSE_GONE',
      reason: 'RULE_TEXT_PRESENT',
      written: false,
    })
    expect(s.downgraded).toBe(0)
  })

  it("an unreadable source (reader threw) leaves the project's rows UNDECIDABLE, not guessed", async () => {
    findOpen.mockResolvedValue([policyRow()])
    readSourceViaCompiler.mockRejectedValue(new Error('GitHub 500'))
    const s = await boundaryCrossingRejudgeService.sweep()
    expect(downgrade).not.toHaveBeenCalled()
    expect(s.byReason).toEqual({ SOURCE_UNREADABLE: 1 })
  })

  it('a project with no linked repository has no readable source', async () => {
    findOpen.mockResolvedValue([policyRow()])
    findDefaultRepo.mockResolvedValue(null)
    const s = await boundaryCrossingRejudgeService.sweep()
    expect(readSourceViaCompiler).not.toHaveBeenCalled()
    expect(s.byReason).toEqual({ SOURCE_UNREADABLE: 1 })
  })

  it('a row that throws is counted as an error and the pass continues', async () => {
    findOpen.mockResolvedValue([policyRow(), policyRow({ id: 'pw2' })])
    downgrade
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce(1)
    const s = await boundaryCrossingRejudgeService.sweep()
    expect(s).toMatchObject({ judged: 1, downgraded: 1, errors: 1 })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('pw1'))
  })

  it('accepts an injected source reader (the script path)', async () => {
    findOpen.mockResolvedValue([policyRow()])
    const readSource = jest.fn().mockResolvedValue(SOURCE)
    await boundaryCrossingRejudgeService.sweep({ readSource, dryRun: true })
    expect(readSource).toHaveBeenCalledTimes(1)
    expect(readSourceViaCompiler).not.toHaveBeenCalled()
  })
})
