import { fireEvent, render, screen } from '@testing-library/react'
import { SectionAddButton } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/SectionAddButton'
import { ToolbarButton } from '@/app/workspace/[workspaceUrl]/components/bubble-menu/ToolbarButton'

// LUM-1271: icon-only buttons carry a real Tooltip instead of a native
// `title`, and keep their accessible name through aria-label.
beforeAll(() => {
  // Radix positions tooltip content with ResizeObserver, which jsdom lacks.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

describe('icon-only buttons use Tooltip, not title', () => {
  it('SectionAddButton is named by aria-label and shows its tooltip on focus', async () => {
    render(<SectionAddButton label='Add test case' />)
    const button = screen.getByRole('button', { name: 'Add test case' })
    expect(button).not.toHaveAttribute('title')

    fireEvent.focus(button)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Add test case'
    )
  })

  it('ToolbarButton gets its accessible name from the title prop', () => {
    render(
      <ToolbarButton onClick={() => {}} title='Bold ⌘B'>
        <span>B</span>
      </ToolbarButton>
    )
    const button = screen.getByRole('button', { name: 'Bold ⌘B' })
    expect(button).not.toHaveAttribute('title')
  })
})
