/** @jest-environment jsdom */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ActionTooltip } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/ActionTooltip'

beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn()
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
  // jsdom has no ResizeObserver; Radix tooltip arrow uses it for sizing.
  if (typeof global.ResizeObserver === 'undefined') {
    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
})

describe('ActionTooltip', () => {
  it('reveals the tip on focus and does not nest a button inside the control', async () => {
    const user = userEvent.setup()
    render(
      <ActionTooltip tip='Accept the task as done.'>
        <button type='button' data-testid='ctl'>
          Pass
        </button>
      </ActionTooltip>
    )
    const control = screen.getByTestId('ctl')
    // The control itself is the trigger — no extra <button> wrapper inside it.
    expect(control.querySelector('button')).toBeNull()
    // Tip is not in the DOM until the trigger is focused/hovered (Radix).
    expect(screen.queryByText('Accept the task as done.')).toBeNull()
    await user.tab()
    expect(control).toHaveFocus()
    // Radix renders the open tooltip content (in a portal); delayDuration=0.
    expect(
      await screen.findAllByText('Accept the task as done.')
    ).not.toHaveLength(0)
  })
})
