import { render, screen, fireEvent } from '@testing-library/react'
import { DeliveryTab } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/DeliveryTab'

jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (d: { defaultMessage?: string; id?: string }) =>
      d.defaultMessage ?? d.id ?? '',
  }),
}))

const mockUseAgentRuns = jest.fn()
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useAgentRuns', () => ({
  useAgentRuns: (...a: unknown[]) => mockUseAgentRuns(...a),
}))
jest.mock('@/app/workspace/[workspaceUrl]/components/DeliveryPanel', () => ({
  DeliveryPanel: ({ footer }: { footer?: React.ReactNode }) => (
    <div data-testid='panel-delivery'>{footer}</div>
  ),
}))
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/TokenUsageSection',
  () => ({ TokenUsageSection: () => <div data-testid='token-section' /> })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/AgentRunList',
  () => ({ AgentRunList: () => <div data-testid='run-list' /> })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/AcceptanceTab',
  () => ({ AcceptanceTab: () => <div data-testid='panel-acceptance' /> })
)

const baseProps = {
  taskId: 't1',
  taskIdentifier: 'LUM-1',
  taskStatus: 'IN_REVIEW' as const,
  agentStatus: null,
  workspaceUrl: 'acme',
  members: [],
  agentActors: [],
  enabled: true,
  subTab: 'runs' as const,
  onSubTabChange: jest.fn(),
  onVerdictRecorded: jest.fn(),
}

function armRuns(runCount: number) {
  mockUseAgentRuns.mockReturnValue({
    data: {
      runs: Array.from({ length: runCount }, (_, i) => ({
        sessionId: `s${i}`,
        runNumber: i + 1,
      })),
      totals: {
        runCount,
        turnCount: runCount,
        loopCount: runCount,
        byModel: runCount ? [{ model: 'm', total: 1 }] : [],
      },
      perMember: [],
    },
    loading: false,
    error: null,
  })
}

describe('DeliveryTab', () => {
  beforeEach(() => mockUseAgentRuns.mockReset())

  it('renders the delivery card with the token section inside it (runs subtab)', () => {
    armRuns(1)
    render(<DeliveryTab {...baseProps} subTab='runs' />)
    const panel = screen.getByTestId('panel-delivery')
    expect(panel).toBeInTheDocument()
    expect(panel).toContainElement(screen.getByTestId('token-section'))
  })

  it('renders the run list below the card when runs exist', () => {
    armRuns(2)
    render(<DeliveryTab {...baseProps} subTab='runs' />)
    expect(screen.getByTestId('run-list')).toBeInTheDocument()
  })

  it('omits the run list when there are no runs', () => {
    armRuns(0)
    render(<DeliveryTab {...baseProps} subTab='runs' />)
    expect(screen.queryByTestId('run-list')).not.toBeInTheDocument()
  })

  it('shows the Acceptance sub-segment when subTab=acceptance', () => {
    armRuns(0)
    render(<DeliveryTab {...baseProps} subTab='acceptance' />)
    expect(screen.getByTestId('panel-acceptance')).toBeInTheDocument()
    expect(screen.queryByTestId('panel-delivery')).not.toBeInTheDocument()
  })

  it('calls onSubTabChange when a segment button is clicked', () => {
    armRuns(0)
    const onSubTabChange = jest.fn()
    render(
      <DeliveryTab
        {...baseProps}
        subTab='runs'
        onSubTabChange={onSubTabChange}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Acceptance' }))
    expect(onSubTabChange).toHaveBeenCalledWith('acceptance')
  })

  it('omits the token section when runs exist but captured no model usage', () => {
    mockUseAgentRuns.mockReturnValue({
      data: {
        runs: [{ sessionId: 's0', runNumber: 1 }],
        totals: { runCount: 1, turnCount: 1, loopCount: 1, byModel: [] },
        perMember: [],
      },
      loading: false,
      error: null,
    })
    render(<DeliveryTab {...baseProps} subTab='runs' />)
    expect(screen.getByTestId('panel-delivery')).toBeInTheDocument()
    expect(screen.queryByTestId('token-section')).not.toBeInTheDocument()
  })
})
