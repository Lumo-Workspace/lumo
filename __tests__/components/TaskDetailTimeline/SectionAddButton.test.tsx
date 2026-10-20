import { render, screen, fireEvent } from '@testing-library/react'
import { createRef } from 'react'
import { SectionAddButton } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/SectionAddButton'

describe('SectionAddButton', () => {
  it('renders an accessible button with the given label', () => {
    render(<SectionAddButton label='Add Slack message' />)
    const btn = screen.getByRole('button', { name: 'Add Slack message' })
    expect(btn).toBeInTheDocument()
    // LUM-1271: the label shows as a Tooltip, not a native title.
    expect(btn).not.toHaveAttribute('title')
  })

  it('invokes onClick when clicked', () => {
    const onClick = jest.fn()
    render(<SectionAddButton label='Add' onClick={onClick} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('forwards refs so it can be used as a PopoverTrigger asChild', () => {
    const ref = createRef<HTMLButtonElement>()
    render(<SectionAddButton ref={ref} label='Link PR' />)
    expect(ref.current).toBeInstanceOf(HTMLButtonElement)
  })
})
