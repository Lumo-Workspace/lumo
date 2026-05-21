import { render, screen, fireEvent } from '@testing-library/react'
import { Accordion } from '@/components/landing/ui/accordion'
import { ContextSection } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/ContextSection'

describe('ContextSection', () => {
  it('renders label and count', () => {
    render(
      <Accordion type='multiple'>
        <ContextSection value='slack' label='Slack' count={3}>
          <div>body</div>
        </ContextSection>
      </Accordion>
    )
    expect(screen.getByText('Slack')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('renders the addSlot when provided', () => {
    render(
      <Accordion type='multiple'>
        <ContextSection
          value='slack'
          label='Slack'
          count={0}
          addSlot={<button>Add</button>}
        >
          <div>body</div>
        </ContextSection>
      </Accordion>
    )
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
  })

  it('expands body when defaultValue includes section value', () => {
    render(
      <Accordion type='multiple' defaultValue={['slack']}>
        <ContextSection value='slack' label='Slack' count={1}>
          <div>body-content</div>
        </ContextSection>
      </Accordion>
    )
    expect(screen.getByText('body-content')).toBeVisible()
  })

  it('toggles the section when the dead zone next to the addSlot is clicked', () => {
    const onAdd = jest.fn()
    const { container } = render(
      <Accordion type='multiple'>
        <ContextSection
          value='slack'
          label='Slack'
          count={0}
          addSlot={<button onClick={onAdd}>Add</button>}
        >
          <div>body-content</div>
        </ContextSection>
      </Accordion>
    )
    // The header row is the wrapper div inside the AccordionItem.
    const row = container.querySelector(
      '[data-slot="accordion-item"] > div'
    ) as HTMLDivElement
    expect(row).toBeTruthy()
    // Click the row container itself — that simulates clicking the dead zone
    // around the + button. The body becomes visible after toggling.
    fireEvent.click(row)
    expect(screen.getByText('body-content')).toBeVisible()
    // The + button must NOT be triggered as a side effect.
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('does not toggle when the addSlot itself is clicked', () => {
    const onAdd = jest.fn()
    render(
      <Accordion type='multiple'>
        <ContextSection
          value='slack'
          label='Slack'
          count={0}
          addSlot={<button onClick={onAdd}>Add</button>}
        >
          <div>body-content</div>
        </ContextSection>
      </Accordion>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(onAdd).toHaveBeenCalledTimes(1)
    // Body should still be hidden (section did not expand).
    expect(screen.queryByText('body-content')).not.toBeInTheDocument()
  })
})
