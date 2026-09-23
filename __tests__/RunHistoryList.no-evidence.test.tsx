/**
 * @jest-environment jsdom
 *
 * LUM-819 (C): 零证据的 PASS 在 run 历史里显示为「划掉的 PASS + Unproven +
 * 没有证据」，而不是一个绿 PASS，也不是失败。
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
      formatMessage: ({ id }: { id: string }) => messages[id] ?? id,
      formatDate: () => '',
    }),
  }
})

import { RunHistoryList } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/RunHistoryList'

const passRun = (evidence: unknown[]) =>
  ({
    id: 'r1',
    testCaseId: 'tc-1',
    taskId: 't-1',
    result: 'PASS',
    environment: 'LOCAL',
    failureAttribution: null,
    unprovenVerification: [],
    failedPhase: null,
    failedIndex: null,
    failedStepText: null,
    evidence,
    note: null,
    pullRequestId: null,
    commitSha: null,
    commitDirty: null,
    actorMemberId: null,
    sourceSessionId: null,
    createdAt: '2026-09-23T08:00:00.000Z',
    disposition: null,
  }) as never

function renderRuns(evidence: unknown[]) {
  return render(
    <RunHistoryList
      runs={[passRun(evidence)]}
      pullRequests={[]}
      requiredEnvironment={null}
      onDispose={jest.fn()}
    />
  )
}

describe('RunHistoryList — no-evidence ceiling', () => {
  it('shows a zero-evidence PASS as Unproven with the no-evidence reason', () => {
    renderRuns([])
    expect(screen.getByText('Unproven')).toBeInTheDocument()
    expect(
      screen.getByText(
        'no evidence attached — nobody else can re-read this pass'
      )
    ).toBeInTheDocument()
  })

  it('leaves a PASS that carries evidence alone', () => {
    renderRuns([{ type: 'link', url: 'https://example.test/log' }])
    expect(screen.queryByText('Unproven')).not.toBeInTheDocument()
  })
})
