/**
 * @jest-environment jsdom
 *
 * LUM-812: 裁定按钮只挂在用例**最新**那条未裁定的已证缺陷上。
 *
 * LUM-812/TC1 生产复跑发现：更早一条未裁定的 defect run 也挂着「Blocking DONE」
 * + 两个按钮。闸门只读最新一条，服务端对非最新 run 的裁定回 409——那条提示
 * 说错了，按钮点了也只会报错。
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

jest.mock('react-intl', () => {
  const messages = jest.requireActual('@/lib/i18n/en.json') as Record<
    string,
    string
  >
  return {
    useIntl: () => ({
      formatMessage: (
        { id }: { id: string },
        values?: Record<string, unknown>
      ) => {
        let raw = messages[id] ?? id
        for (const [k, v] of Object.entries(values ?? {}))
          raw = raw.replace(`{${k}}`, String(v))
        return raw
      },
    }),
  }
})

import {
  RunHistoryList,
  ruleableRunId,
} from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/RunHistoryList'

const run = (
  id: string,
  createdAt: string,
  over: Record<string, unknown> = {}
) =>
  ({
    id,
    testCaseId: 'tc-1',
    taskId: 't-1',
    result: 'FAIL',
    environment: 'LOCAL',
    failureAttribution: 'IMPLEMENTATION_DEFECT',
    unprovenVerification: [],
    failedPhase: null,
    failedIndex: null,
    failedStepText: null,
    evidence: [{ type: 'link', url: 'https://example.test/log' }],
    note: null,
    pullRequestId: null,
    commitSha: null,
    commitDirty: null,
    actorMemberId: null,
    sourceSessionId: null,
    createdAt,
    disposition: null,
    ...over,
  }) as never

const RULED = {
  id: 'd-1',
  disposition: 'KNOWN_DEFECT',
  note: null,
  dispositionedById: 'm-1',
  dispositionedAt: '2026-09-23T07:20:00.000Z',
  channel: 'CLI',
}

describe('ruleableRunId', () => {
  it('picks the latest run when it is an unruled proven defect', () => {
    expect(
      ruleableRunId([
        run('new', '2026-09-23T08:00:00.000Z'),
        run('old', '2026-09-23T07:00:00.000Z'),
      ])
    ).toBe('new')
  })

  it('never offers an older unruled defect, even when the latest is already ruled', () => {
    expect(
      ruleableRunId([
        run('new', '2026-09-23T08:00:00.000Z', { disposition: RULED }),
        run('old', '2026-09-23T07:00:00.000Z'),
      ])
    ).toBeNull()
  })

  it('goes by createdAt, not by the order it was handed', () => {
    expect(
      ruleableRunId([
        run('old', '2026-09-23T07:00:00.000Z'),
        run('new', '2026-09-23T08:00:00.000Z'),
      ])
    ).toBe('new')
  })

  it('returns null when the latest run is not a proven defect', () => {
    expect(
      ruleableRunId([
        run('pass', '2026-09-23T08:00:00.000Z', {
          result: 'PASS',
          failureAttribution: null,
        }),
        run('old', '2026-09-23T07:00:00.000Z'),
      ])
    ).toBeNull()
    expect(ruleableRunId([])).toBeNull()
  })
})

describe('RunHistoryList ruling controls', () => {
  it('renders the blocking prompt and both buttons exactly once — on the latest run', () => {
    // 生产上 LUM-818/TC1 的形状：新到旧 = 未裁定 / 已裁定 / 未裁定 / 已裁定。
    render(
      <RunHistoryList
        runs={[
          run('r4', '2026-09-23T07:55:00.000Z'),
          run('r3', '2026-09-23T07:52:00.000Z', { disposition: RULED }),
          run('r2', '2026-09-23T07:25:00.000Z'),
          run('r1', '2026-09-23T07:14:00.000Z', { disposition: RULED }),
        ]}
        pullRequests={[]}
        requiredEnvironment={null}
        onDispose={jest.fn()}
      />
    )
    expect(screen.getAllByText(/Blocking DONE/)).toHaveLength(1)
    expect(screen.getAllByRole('button')).toHaveLength(2)
    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent(/Blocking DONE/)
    expect(items[2]).not.toHaveTextContent(/Blocking DONE/)
  })
})
