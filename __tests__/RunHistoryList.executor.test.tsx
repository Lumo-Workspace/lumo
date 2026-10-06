/**
 * @jest-environment jsdom
 *
 * LUM-1008：每条 run 显示谁跑的、从哪跑的。有来源 session = agent 代跑，给一个
 * 指向 session 时间线的短 id；执行人为 null 读作「未记录」；读端没带就不画。
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
          raw = raw.split(`{${k}}`).join(String(v))
        return raw
      },
    }),
  }
})

import { RunHistoryList } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/RunHistoryList'

const run = (
  id: string,
  executor: { executedBy?: string | null; sourceSessionId: string | null }
) =>
  ({
    id,
    testCaseId: 'tc-1',
    taskId: 't-1',
    result: 'PASS',
    environment: 'LOCAL',
    failureAttribution: null,
    unprovenVerification: [],
    failedPhase: null,
    failedIndex: null,
    failedStepText: null,
    evidence: [],
    note: null,
    pullRequestId: null,
    commitSha: null,
    commitDirty: null,
    executedByMemberId: null,
    createdAt: '2026-10-06T08:00:00.000Z',
    disposition: null,
    review: null,
    ...executor,
  }) as never

const row = (id: string) => document.getElementById(`run-${id}`)!

describe('RunHistoryList — who ran it', () => {
  beforeEach(() => {
    render(
      <RunHistoryList
        runs={[
          run('r-agent', {
            executedBy: 'Ada Lovelace',
            sourceSessionId: '86dce765-abe3-4254-89c8-7a788200194a',
          }),
          run('r-human', { executedBy: 'Bo', sourceSessionId: null }),
          run('r-unknown', { executedBy: null, sourceSessionId: null }),
          run('r-absent', { sourceSessionId: null }),
        ]}
        pullRequests={[]}
        requiredEnvironment={null}
      />
    )
  })

  it('names the runner and links the agent session it came from', () => {
    expect(row('r-agent')).toHaveTextContent('by Ada Lovelace')
    const link = screen.getByRole('link', { name: 'via session 86dce765' })
    expect(link).toHaveAttribute(
      'href',
      '/sessions/86dce765-abe3-4254-89c8-7a788200194a'
    )
    expect(row('r-agent')).toContainElement(link)
  })

  it('shows a runner without a session link when no session was recorded', () => {
    expect(row('r-human')).toHaveTextContent('by Bo')
    expect(row('r-human').querySelector('a')).toBeNull()
  })

  it('reads a null runner as "not recorded", never as nobody', () => {
    expect(row('r-unknown')).toHaveTextContent('runner not recorded')
  })

  it('draws nothing when the reader did not carry the runner', () => {
    expect(row('r-absent')).not.toHaveTextContent('runner not recorded')
    expect(row('r-absent')).not.toHaveTextContent(/\bby\b/)
  })
})
