/**
 * @jest-environment node
 *
 * LUM-819 返工（用户送回：「单独入口，没有任务的 context，怎么检查？」）。
 *
 * 1. 抽查卡片带上证据要对照的东西：预期结果、步骤、复验条目、覆盖的标准原文
 *    （三态）、PR，以及直达该任务 Tests 标签、定位到这条 run 的链接。
 * 2. 复核结果回写到任务：执行历史带上最新复核；最新一次执行被打回的用例在
 *    task status 里是一条 advisory，不进 DONE 闸。
 * 3. 抽查入口在 Dashboard，不在侧边栏。
 */
import { readFileSync } from 'fs'
import { join } from 'path'

jest.mock('@/lib/repositories/test-case-run-review.repository', () => ({
  testCaseRunReviewRepository: {
    create: jest.fn(),
    listForWorkspace: jest.fn(),
    listForTask: jest.fn(),
    listPassCandidates: jest.fn(),
    findCandidate: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/test-case.repository', () => ({
  testCaseRepository: {
    listForTask: jest.fn(),
    runsPerCase: jest.fn(),
    listTaskPullRequests: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    labelsByIds: jest.fn(
      async (ids: string[]) => new Map(ids.map(id => [id, `name-of-${id}`]))
    ),
    findActorByMemberId: jest.fn(),
  },
}))

import { testCaseRunReviewRepository } from '@/lib/repositories/test-case-run-review.repository'
import { testCaseRepository } from '@/lib/repositories/test-case.repository'
import { testCaseReviewService } from '@/lib/services/test-case-review.service'
import { taskTestCaseService } from '@/lib/services/task-test-case.service'
import {
  reviewSentBackStatement,
  sentBackOnLatestRuns,
} from '@/lib/test-cases/review'
import {
  runAnchorId,
  testRunHref,
} from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/taskTabs'
import { splitNextActions } from '../cli/src/commands/task-status'

const reviewRepo = testCaseRunReviewRepository as unknown as Record<
  string,
  jest.Mock
>
const caseRepo = testCaseRepository as unknown as Record<string, jest.Mock>

const at = (m: number) => new Date(Date.UTC(2026, 8, 23, 0, m))

function candidate(over: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    taskId: 't-1',
    result: 'PASS',
    environment: 'PRODUCTION',
    unprovenVerification: [],
    evidence: [{ type: 'link', url: 'https://example.test/log' }],
    note: null,
    commitSha: 'abcdef1234',
    commitDirty: false,
    createdAt: at(0),
    testCase: {
      number: 3,
      title: 'login works',
      requiredEnvironment: null,
      setup: 'a user account exists',
      steps: ['open /login', 'sign in'],
      verification: ['the dashboard is shown'],
      expected: 'The user lands on the dashboard.',
    },
    pullRequest: { number: 42, url: 'https://github.com/x/y/pull/42' },
    task: { number: 42, title: 'Login', team: { identifier: 'LUM' } },
    ...over,
  }
}

const review = (
  runId: string,
  accepted: boolean,
  m: number,
  note: string | null = null
) => ({
  testCaseRunId: runId,
  accepted,
  createdAt: at(m),
  note,
  reviewedByMemberId: 'm-ann',
})

beforeEach(() => jest.clearAllMocks())

describe('LUM-819 rework: review in context', () => {
  it('each review card carries what the evidence must be checked against', async () => {
    reviewRepo.listPassCandidates!.mockResolvedValue([
      candidate(),
      candidate({
        id: 'run-2',
        pullRequest: null,
      }),
      candidate({
        id: 'run-3',
        testCase: { ...candidate().testCase, setup: null },
      }),
    ])
    reviewRepo.listForWorkspace!.mockResolvedValue([])
    const view = await testCaseReviewService.getPool('w-1', {
      random: () => 0.999,
    })
    const byId = new Map(view.sample.map(i => [i.runId, i]))

    expect(byId.get('run-1')).toMatchObject({
      expected: 'The user lands on the dashboard.',
      steps: ['open /login', 'sign in'],
      verification: ['the dashboard is shown'],
      setup: 'a user account exists',
      pr: { number: 42, url: 'https://github.com/x/y/pull/42' },
      taskIdentifier: 'LUM-42',
    })
    expect(byId.get('run-2')!.pr).toBeNull()
    expect(byId.get('run-3')!.setup).toBeNull()

    // deep link lands on that run inside the task's Record tab (LUM-1011)
    expect(testRunHref('lumo', 'LUM-42', 'run-1')).toBe(
      '/workspace/lumo/my-tasks/LUM-42/record#run-run-1'
    )
    expect(runAnchorId('run-1')).toBe('run-run-1')
  })

  it('a review verdict shows up on its task and stays advisory', async () => {
    // pure: only a sent-back review on a case's LATEST run counts
    const cases = [
      { id: 'c1', number: 1, title: 'one' },
      { id: 'c2', number: 2, title: 'two' },
      { id: 'c3', number: 3, title: 'three' },
    ]
    const latestRun = new Map([
      ['c1', 'r1-new'],
      ['c2', 'r2'],
      ['c3', 'r3'],
    ])
    const hits = sentBackOnLatestRuns(cases, latestRun, [
      review('r1-old', false, 1), // superseded by a re-run → silent
      review('r2', false, 1),
      review('r2', true, 2), // changed their mind → latest says holds
      review('r3', true, 1),
      review('r3', false, 3, 'log is from another branch'),
    ])
    expect(hits.map(h => h.testCase.number)).toEqual([3])

    // service: attaches the latest review (with a display name) to each run
    // LUM-1185: listForTask derives each run's verdict from the case body, so
    // the fixture carries the columns a real case row always has.
    caseRepo.listForTask!.mockResolvedValue([
      {
        id: 'c3',
        number: 3,
        title: 'three',
        steps: ['a'],
        verification: [],
        requiredEnvironment: null,
      },
    ])
    caseRepo.runsPerCase!.mockResolvedValue(
      new Map([
        [
          'c3',
          [
            { id: 'r3', testCaseId: 'c3' },
            { id: 'r3-old', testCaseId: 'c3' },
          ],
        ],
      ])
    )
    caseRepo.listTaskPullRequests!.mockResolvedValue([])
    reviewRepo.listForTask!.mockResolvedValue([
      review('r3', true, 1),
      review('r3', false, 3, 'log is from another branch'),
    ])
    const listed = await taskTestCaseService.listForTask('t-1')
    const runs = listed.testCases[0]!.runs
    expect(runs[0]!.review).toEqual({
      accepted: false,
      note: 'log is from another branch',
      reviewer: 'name-of-m-ann',
      reviewedAt: at(3).toISOString(),
    })
    expect(runs[1]!.review).toBeNull()

    // task status advisory: reviewer + note, phrased as "evidence did not hold", not a failure
    const sent = await testCaseReviewService.sentBackForTask('t-1')
    expect(sent).toEqual([
      {
        number: 3,
        title: 'three',
        reviewer: 'name-of-m-ann',
        note: 'log is from another branch',
      },
    ])
    const line = reviewSentBackStatement(sent[0]!)
    expect(line).toContain('sent this PASS back')
    expect(line).toContain('name-of-m-ann')
    expect(line).not.toMatch(/\bFAIL\b|✗/)

    // fail-soft: a read error means no line, never a broken status
    reviewRepo.listForTask!.mockRejectedValueOnce(new Error('db down'))
    await expect(testCaseReviewService.sentBackForTask('t-1')).resolves.toEqual(
      []
    )

    // it rides as a TEST_CASE advisory, and an unknown advisory kind lands in
    // the same advisory bucket — never as a blocker
    const split = splitNextActions([
      {
        kind: 'TEST_CASE',
        statement: line,
        command: 'lumo task testcase show LUM-1/TC3',
        advisory: true,
      },
      { kind: 'SOMETHING_NEWER', statement: 'x', advisory: true } as never,
    ])
    expect(split.security).toEqual([])
    expect(split.testCase).toHaveLength(2)

    // the DONE gate has no path to review data
    for (const f of [
      'lib/acceptance/done-verdict.ts',
      'lib/services/done-verdict.service.ts',
    ]) {
      expect(readFileSync(join(process.cwd(), f), 'utf8')).not.toMatch(
        /review/i
      )
    }
  })

  it('the review entry lives on the dashboard, not the sidebar', () => {
    const src = (f: string) =>
      readFileSync(
        join(process.cwd(), 'app/workspace/[workspaceUrl]', f),
        'utf8'
      )
    expect(src('components/Sidebar.tsx')).not.toMatch(/run-reviews|runReviews/)
    const dashboard = src('components/pages/DashboardPage.tsx')
    expect(dashboard).toMatch(/<SpotCheckCard/)
    expect(dashboard).toMatch(/onOpen=\{onOpenRunReviews\}/)
    expect(src('components/WorkspacePageRouter.tsx')).toMatch(
      /onOpenRunReviews=\{\(\) => navigateTo\('run-reviews'\)\}/
    )
    // the page itself is still routable (the dashboard card links to it)
    expect(src('utils/pathToPage.ts')).toMatch(/'\/run-reviews'/)
  })
})
