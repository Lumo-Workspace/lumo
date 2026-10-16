/**
 * @jest-environment jsdom
 *
 * LUM-1191: one fixture, two surfaces. The same candidate rows go through the
 * real pool service once; the web run-reviews page and `lumo spot-check`
 * render that one payload and agree on which runs are waiting, on the pool
 * size, and on the false-report readout.
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

jest.mock('react-intl', () => {
  const messages = jest.requireActual('@/lib/i18n/en.json') as Record<
    string,
    string
  >
  const fill = (id: string, values?: Record<string, unknown>) => {
    let raw = messages[id] ?? id
    for (const [k, v] of Object.entries(values ?? {}))
      raw = raw.split(`{${k}}`).join(String(v))
    return raw
  }
  return {
    useIntl: () => ({
      formatMessage: (
        { id }: { id: string },
        values?: Record<string, unknown>
      ) => fill(id, values),
      formatNumber: (n: number) => `${Math.round(n * 100)}%`,
      formatDate: () => 'Sep 23, 2026',
    }),
  }
})
jest.mock('@/app/workspace/[workspaceUrl]/components/PageBreadcrumb', () => ({
  PageBreadcrumb: ({ title }: { title: string }) => <h1>{title}</h1>,
}))
jest.mock('@/lib/repositories/test-case-run-review.repository', () => ({
  testCaseRunReviewRepository: {
    listForWorkspace: jest.fn(),
    listPassCandidates: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    labelsByIds: jest.fn(
      async (ids: string[]) => new Map(ids.map(id => [id, `name-of-${id}`]))
    ),
  },
}))

import { RunReviewView } from '@/app/workspace/[workspaceUrl]/components/pages/RunReviewView'
import { testCaseRunReviewRepository } from '@/lib/repositories/test-case-run-review.repository'
import { testCaseReviewService } from '@/lib/services/test-case-review.service'
import { formatSpotCheck } from '@/cli/src/commands/spot-check'

const repo = testCaseRunReviewRepository as unknown as Record<string, jest.Mock>

function candidate(
  id: string,
  caseNumber: number,
  over: Record<string, unknown> = {}
) {
  return {
    id,
    taskId: 't-1',
    result: 'PASS',
    environment: 'PRODUCTION',
    unprovenVerification: [],
    evidence: [{ type: 'link', url: `https://example.test/${id}.log` }],
    stepResults: [],
    note: null,
    commitSha: 'abcdef1234',
    commitDirty: false,
    executedByMemberId: 'm-1',
    sourceSessionId: null,
    createdAt: new Date('2026-09-23T08:00:00Z'),
    testCase: {
      number: caseNumber,
      title: `case ${caseNumber}`,
      requiredEnvironment: null,
      setup: null,
      steps: ['open'],
      verification: [],
      expected: 'ok',
    },
    pullRequest: null,
    task: { number: 42, title: 'Login', team: { identifier: 'LUM' } },
    ...over,
  }
}

const at = (m: number) => new Date(Date.UTC(2026, 8, 23, 0, m))

beforeEach(() => {
  // the fixture: two runs still waiting, one already reviewed (sent back),
  // one zero-evidence PASS that never enters the pool
  repo.listPassCandidates!.mockResolvedValue([
    candidate('run-1', 1),
    candidate('run-2', 2, { executedByMemberId: null }),
    candidate('run-3', 3),
    candidate('run-4', 4, { evidence: [] }),
  ])
  repo.listForWorkspace!.mockResolvedValue([
    { testCaseRunId: 'run-3', accepted: true, createdAt: at(1) },
    { testCaseRunId: 'run-3', accepted: false, createdAt: at(2) },
  ])
})

describe('LUM-1191 spot-check: web and CLI agree on one fixture', () => {
  it('the same runs are waiting, with the same pool size and readout', async () => {
    const view = await testCaseReviewService.getPool('w-1', {
      random: () => 0,
    })

    render(
      <RunReviewView
        workspaceUrl='lumo'
        pool={view}
        loading={false}
        error={null}
        onReload={jest.fn()}
        reviewingRunId={null}
        reviewError={null}
        onReview={jest.fn()}
      />
    )
    const cli = formatSpotCheck(view, 'https://lumo.test/run-reviews', {
      tty: false,
      color: false,
    })

    // waiting runs: the reviewed one and the zero-evidence one are absent on both
    for (const n of [1, 2]) {
      expect(screen.getByText(`LUM-42 · TC${n} case ${n}`)).toBeInTheDocument()
      expect(cli).toMatch(new RegExp(`^LUM-42/TC${n}\\s+case ${n}`, 'm'))
    }
    for (const n of [3, 4]) {
      expect(screen.queryByText(`LUM-42 · TC${n} case ${n}`)).toBeNull()
      expect(cli).not.toContain(`LUM-42/TC${n}`)
    }

    // pool size
    expect(
      screen.getByText(
        '2 unreviewed passes in the pool · showing a random sample of 2'
      )
    ).toBeInTheDocument()
    expect(cli).toContain(
      '2 unreviewed passes in the pool · showing a random sample of 2'
    )

    // reviewed result: run-3's latest review sent it back → 1 of 1, thin sample
    expect(
      screen.getByText(/1 of the 10 needed, 1 sent back so far/)
    ).toBeInTheDocument()
    expect(cli).toContain('1 of the 10 needed, 1 sent back so far')

    // the runner (CLI only — the web card does not show it)
    expect(cli).toMatch(/^LUM-42\/TC1\b.*by name-of-m-1/m)
    expect(cli).toMatch(/^LUM-42\/TC2\b.*runner not recorded/m)
  })
})
