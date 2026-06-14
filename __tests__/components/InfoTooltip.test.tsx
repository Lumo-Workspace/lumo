/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { InfoTooltip } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/InfoTooltip'

describe('InfoTooltip', () => {
  it('renders an accessible trigger labeled with the tooltip text', () => {
    render(
      <InfoTooltip label='Machine-verified means a checkpointer ran and passed' />
    )
    const trigger = screen.getByLabelText(
      'Machine-verified means a checkpointer ran and passed'
    )
    expect(trigger).toBeInTheDocument()
    expect(trigger.tagName).toBe('BUTTON')
    expect(trigger).toHaveAttribute('type', 'button')
  })
})
