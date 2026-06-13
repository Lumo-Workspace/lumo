/** @jest-environment jsdom */

jest.mock(
  '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/AgentRunCard',
  () => ({
    AgentRunCard: ({ run }: { run: { runNumber: number } }) => (
      <div data-testid='run-card'>run-{run.runNumber}</div>
    ),
  })
)

import { render, screen } from '@testing-library/react'
import { AgentRunList } from '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/AgentRunList'
import type { AgentRunSession } from '@/app/workspace/[workspaceUrl]/types'

const runs = [
  { sessionId: 's1', runNumber: 1 },
  { sessionId: null, runNumber: 2 },
] as unknown as AgentRunSession[]

describe('AgentRunList', () => {
  it('renders one card per run', () => {
    render(<AgentRunList runs={runs} />)
    expect(screen.getAllByTestId('run-card')).toHaveLength(2)
    expect(screen.getByText('run-1')).toBeInTheDocument()
    expect(screen.getByText('run-2')).toBeInTheDocument()
  })
})
