import { render, screen } from '@testing-library/react'
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
})
