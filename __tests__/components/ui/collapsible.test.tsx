/**
 * LUM-1267: disclosures share the Collapsible primitive, so Enter / Space on
 * the trigger toggle the region and the trigger carries the ARIA state.
 */
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  Collapsible,
  CollapsibleCard,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { RecordRow } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/RecordRow'

function Disclosure() {
  return (
    <Collapsible>
      <CollapsibleTrigger>Details</CollapsibleTrigger>
      <CollapsibleContent>Body</CollapsibleContent>
    </Collapsible>
  )
}

it('toggles with Enter and Space and reflects the state in ARIA', async () => {
  const user = userEvent.setup()
  render(<Disclosure />)
  const trigger = screen.getByRole('button', { name: 'Details' })
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText('Body')).not.toBeInTheDocument()

  trigger.focus()
  await user.keyboard('{Enter}')
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(trigger).toHaveAttribute('data-state', 'open')
  expect(screen.getByText('Body')).toBeInTheDocument()

  await user.keyboard(' ')
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText('Body')).not.toBeInTheDocument()
})

it('marks the trigger as the chevron group', () => {
  render(<Disclosure />)
  expect(screen.getByRole('button', { name: 'Details' })).toHaveClass(
    'group/collapsible'
  )
})

function ControlledRow() {
  const [open, setOpen] = useState(false)
  return (
    <RecordRow
      id='row'
      title='Crossings'
      expanded={open}
      onToggle={() => setOpen(v => !v)}
    >
      Row body
    </RecordRow>
  )
}

it('keeps a parent-controlled row (RecordRow) keyboard-operable', async () => {
  const user = userEvent.setup()
  render(<ControlledRow />)
  const trigger = screen.getByRole('button', { name: /Crossings/ })
  trigger.focus()
  await user.keyboard('{Enter}')
  expect(screen.getByText('Row body')).toBeInTheDocument()
  await user.keyboard(' ')
  expect(screen.queryByText('Row body')).not.toBeInTheDocument()
})

// LUM-1272: a disclosure whose root is the Card surface.
it('renders CollapsibleCard as a Card root that still toggles from the keyboard', async () => {
  const user = userEvent.setup()
  render(
    <CollapsibleCard data-testid='card' className='px-3'>
      <CollapsibleTrigger>Finding</CollapsibleTrigger>
      <CollapsibleContent>Finding body</CollapsibleContent>
    </CollapsibleCard>
  )
  const card = screen.getByTestId('card')
  expect(card).toHaveClass('rounded-lg', 'border', 'bg-card', 'px-3')
  expect(card).toHaveAttribute('data-state', 'closed')
  const trigger = screen.getByRole('button', { name: 'Finding' })
  trigger.focus()
  await user.keyboard('{Enter}')
  expect(card).toHaveAttribute('data-state', 'open')
  expect(screen.getByText('Finding body')).toBeInTheDocument()
  await user.keyboard(' ')
  expect(screen.queryByText('Finding body')).not.toBeInTheDocument()
})
