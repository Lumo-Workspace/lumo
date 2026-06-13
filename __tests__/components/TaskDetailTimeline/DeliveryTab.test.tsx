import { render, screen, fireEvent } from '@testing-library/react'
import { DeliveryTab } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/DeliveryTab'

jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (d: { defaultMessage?: string; id?: string }) =>
      d.defaultMessage ?? d.id ?? '',
  }),
}))
jest.mock('@/app/workspace/[workspaceUrl]/components/DeliveryPanel', () => ({
  DeliveryPanel: () => <div data-testid='panel-delivery' />,
}))
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/AgentRunTab',
  () => ({ AgentRunTab: () => <div data-testid='panel-runs' /> })
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

describe('DeliveryTab', () => {
  it('always renders the DeliveryPanel summary above the sub-segments', () => {
    render(<DeliveryTab {...baseProps} />)
    expect(screen.getByTestId('panel-delivery')).toBeInTheDocument()
  })

  it('shows the Runs sub-segment when subTab=runs', () => {
    render(<DeliveryTab {...baseProps} subTab='runs' />)
    expect(screen.getByTestId('panel-runs')).toBeInTheDocument()
    expect(screen.queryByTestId('panel-acceptance')).not.toBeInTheDocument()
  })

  it('shows the Acceptance sub-segment when subTab=acceptance', () => {
    render(<DeliveryTab {...baseProps} subTab='acceptance' />)
    expect(screen.getByTestId('panel-acceptance')).toBeInTheDocument()
    expect(screen.queryByTestId('panel-runs')).not.toBeInTheDocument()
  })

  it('calls onSubTabChange when a segment button is clicked', () => {
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
})
