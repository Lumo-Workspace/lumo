/** @jest-environment jsdom */
/**
 * LUM-932 — the pre-dedupe flag is derived from the runs' stored startedAt and
 * threaded to the delivery panel (AgentRunsSection) and the Cost tile
 * (TaskDossier -> RecordTab costPreDedupe).
 */
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({
      id,
      defaultMessage,
    }: {
      id: string
      defaultMessage?: string
    }) => defaultMessage ?? id,
  }),
}))

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useAgentRuns', () => ({
  useAgentRuns: jest.fn(),
}))
// LUM-1011: the dossier reads test cases (Done gate row + Test cases section).
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useTestCases', () => ({
  useTestCases: jest.fn(() => ({
    testCases: [],
    pullRequests: [],
    loading: false,
    error: null,
    add: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    recordRun: jest.fn(),
    disposeDefect: jest.fn(),
  })),
}))
// LUM-1064: core test, run without the security plugin (the OSS build).
jest.mock('@/lib/plugins/installed.client', () => ({
  INSTALLED_CLIENT_PLUGINS: [],
}))
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/RecordTab',
  () => ({
    RecordTab: (props: { costPreDedupe?: boolean }) => (
      <div
        data-testid='acceptance-surface'
        data-pre-dedupe={String(props.costPreDedupe)}
      />
    ),
  })
)
jest.mock('@/app/workspace/[workspaceUrl]/components/DeliveryPanel', () => ({
  DeliveryPanel: (props: { preDedupe?: boolean }) => (
    <div
      data-testid='delivery-panel'
      data-pre-dedupe={String(props.preDedupe)}
    />
  ),
}))
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/AgentRunList',
  () => ({ AgentRunList: () => <div /> })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/LineageTab',
  () => ({ LineageTab: () => <div /> })
)
jest.mock('@/app/workspace/[workspaceUrl]/components/memory/MemoryTab', () => ({
  MemoryTab: () => <div />,
}))

import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { AgentRunsSection } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/AgentRunsSection'
import { TaskDossier } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/TaskDossier'
import { useAgentRuns } from '@/app/workspace/[workspaceUrl]/hooks/useAgentRuns'

const before = { startedAt: '2026-10-01T10:00:00Z', items: [] }
const after = { startedAt: '2026-10-04T10:00:00Z', items: [] }

describe('AgentRunsSection pre-dedupe wiring', () => {
  const renderSection = (runs: unknown[]) =>
    render(
      <AgentRunsSection taskId='t1' taskStatus='DONE' runs={runs as never} />
    )

  it('passes preDedupe=true when any run started before the cutoff', () => {
    renderSection([after, before])
    expect(screen.getByTestId('delivery-panel')).toHaveAttribute(
      'data-pre-dedupe',
      'true'
    )
  })

  it('passes preDedupe=false when all runs started after the cutoff', () => {
    renderSection([after])
    expect(screen.getByTestId('delivery-panel')).toHaveAttribute(
      'data-pre-dedupe',
      'false'
    )
  })
})

describe('TaskDossier pre-dedupe wiring', () => {
  const props: any = {
    taskId: 'task-1',
    taskIdentifier: 'LUM-1',
    taskStatus: 'IN_REVIEW',
    agentStatus: null,
    workspaceUrl: 'acme',
    members: [],
    agentActors: [],
    enabled: true,
    memberNames: new Map(),
    hasLineage: false,
    hasMemories: false,
    targetSection: null,
  }

  it.each([
    [[before], 'true'],
    [[after], 'false'],
  ])('costPreDedupe for runs %j is %s', (runs, expected) => {
    ;(useAgentRuns as jest.Mock).mockReturnValue({
      data: { runs },
      loading: false,
      error: null,
    })
    render(<TaskDossier {...props} />)
    expect(screen.getByTestId('acceptance-surface')).toHaveAttribute(
      'data-pre-dedupe',
      expected
    )
  })
})

describe('usage resync command and resynced runs', () => {
  const resynced = {
    startedAt: '2026-10-01T10:00:00Z',
    usageResyncedAt: '2026-10-05T10:00:00Z',
    items: [],
  }
  const notResynced = { ...resynced, usageResyncedAt: null }
  const props: any = {
    taskId: 'task-1',
    taskIdentifier: 'LUM-1',
    taskStatus: 'IN_REVIEW',
    agentStatus: null,
    workspaceUrl: 'acme',
    members: [],
    agentActors: [],
    enabled: true,
    onVerdictRecorded: jest.fn(),
    memberNames: new Map(),
    hasLineage: false,
    hasMemories: false,
    targetSection: null,
  }

  it('AgentRunsSection passes preDedupe=false when every pre-cutoff run was resynced', () => {
    render(
      <AgentRunsSection
        taskId='t1'
        taskStatus='DONE'
        runs={[resynced, after] as never}
      />
    )
    expect(screen.getByTestId('delivery-panel')).toHaveAttribute(
      'data-pre-dedupe',
      'false'
    )
  })

  it('AgentRunsSection still passes preDedupe=true for an unresynced pre-cutoff run', () => {
    render(
      <AgentRunsSection
        taskId='t1'
        taskStatus='DONE'
        runs={[resynced, notResynced] as never}
      />
    )
    expect(screen.getByTestId('delivery-panel')).toHaveAttribute(
      'data-pre-dedupe',
      'true'
    )
  })

  it.each([
    [[resynced], 'false'],
    [[notResynced], 'true'],
  ])('TaskDossier costPreDedupe for runs %j is %s', (runs, expected) => {
    ;(useAgentRuns as jest.Mock).mockReturnValue({
      data: { runs },
      loading: false,
      error: null,
    })
    render(<TaskDossier {...props} />)
    expect(screen.getByTestId('acceptance-surface')).toHaveAttribute(
      'data-pre-dedupe',
      expected
    )
  })
})
