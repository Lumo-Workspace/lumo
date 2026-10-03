/** @jest-environment jsdom */

jest.mock('@/app/workspace/[workspaceUrl]/components/ForecastView', () => ({
  ForecastView: () => <div>FORECAST</div>,
}))
jest.mock('@/app/workspace/[workspaceUrl]/components/ProgressView', () => ({
  ProgressView: ({
    footer,
    preDedupe,
  }: {
    footer?: any
    preDedupe?: boolean
  }) => (
    <div>
      PROGRESS{footer}
      {preDedupe ? <span>PRE-DEDUPE</span> : null}
    </div>
  ),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useTaskProgress', () => ({
  useTaskProgress: jest.fn(),
}))

import { render, screen } from '@testing-library/react'
import { DeliveryPanel } from '@/app/workspace/[workspaceUrl]/components/DeliveryPanel'
import { useTaskProgress } from '@/app/workspace/[workspaceUrl]/hooks/useTaskProgress'

const useProgress = useTaskProgress as jest.Mock

beforeEach(() => useProgress.mockReset())

it('renders the progress view (actuals only) when status is DONE and sessions exist — no retrospective (LUM-733)', () => {
  useProgress.mockReturnValue({
    progress: { sessionCount: 2, forecast: {} },
    isLoading: false,
  })
  render(<DeliveryPanel taskId='t1' status='DONE' />)
  expect(screen.getByText('PROGRESS')).toBeInTheDocument()
  expect(screen.queryByText('FORECAST')).toBeNull()
  expect(useProgress).toHaveBeenCalledWith('t1')
})

it('renders nothing for a DONE task with no sessions (a delivered task has no forecast to show)', () => {
  useProgress.mockReturnValue({
    progress: { sessionCount: 0, forecast: {} },
    isLoading: false,
  })
  const { container } = render(<DeliveryPanel taskId='t1' status='DONE' />)
  expect(container).toBeEmptyDOMElement()
})

it('renders the forecast view when no sessions yet', () => {
  useProgress.mockReturnValue({
    progress: { sessionCount: 0, forecast: {} },
    isLoading: false,
  })
  render(<DeliveryPanel taskId='t1' status='IN_PROGRESS' />)
  expect(screen.getByText('FORECAST')).toBeInTheDocument()
})

it('renders the progress view once a session exists', () => {
  useProgress.mockReturnValue({
    progress: { sessionCount: 2, forecast: {} },
    isLoading: false,
  })
  render(<DeliveryPanel taskId='t1' status='IN_PROGRESS' />)
  expect(screen.getByText('PROGRESS')).toBeInTheDocument()
})

it('renders nothing while loading', () => {
  useProgress.mockReturnValue({ progress: undefined, isLoading: true })
  const { container } = render(
    <DeliveryPanel taskId='t1' status='IN_PROGRESS' />
  )
  expect(container).toBeEmptyDOMElement()
})

it('passes footer through to the active view', () => {
  useProgress.mockReturnValue({
    progress: { sessionCount: 2, forecast: {} },
    isLoading: false,
  })
  render(
    <DeliveryPanel
      taskId='t1'
      status='IN_REVIEW'
      footer={<div data-testid='slot' />}
    />
  )
  expect(screen.getByTestId('slot')).toBeInTheDocument()
})

it('forwards preDedupe to the progress view (LUM-932)', () => {
  useProgress.mockReturnValue({
    progress: { sessionCount: 2, forecast: {} },
    isLoading: false,
  })
  const { rerender } = render(
    <DeliveryPanel taskId='t1' status='DONE' preDedupe />
  )
  expect(screen.getByText('PRE-DEDUPE')).toBeInTheDocument()
  rerender(<DeliveryPanel taskId='t1' status='DONE' />)
  expect(screen.queryByText('PRE-DEDUPE')).toBeNull()
})
