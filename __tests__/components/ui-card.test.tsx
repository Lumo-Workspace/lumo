/** @jest-environment jsdom */

/**
 * LUM-1246 — Card is the one card surface: `asChild` puts the surface on a
 * semantic/interactive child, and CardTitle uses the app-sized `text-title`.
 */

import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { Card, CardAction, CardHeader, CardTitle } from '@/components/ui/card'

it('renders a div surface by default and merges className', () => {
  render(<Card data-testid='card' className='rounded-xl p-4' />)
  const el = screen.getByTestId('card')
  expect(el.tagName).toBe('DIV')
  expect(el).toHaveClass('border', 'bg-card', 'p-4')
  expect(el).not.toHaveClass('shadow-elevation-1')
  expect(el).toHaveClass('rounded-xl')
  expect(el).not.toHaveClass('rounded-lg')
})

it('puts the surface on the child element with asChild', () => {
  render(
    <Card asChild className='p-4'>
      <button type='button'>Open</button>
    </Card>
  )
  const btn = screen.getByRole('button', { name: 'Open' })
  expect(btn.tagName).toBe('BUTTON')
  expect(btn).toHaveClass('rounded-lg', 'border', 'bg-card', 'p-4')
})

it('CardAction sits in the header grid as the top-right slot (LUM-1291)', () => {
  render(
    <CardHeader data-testid='header'>
      <CardTitle>Title</CardTitle>
      <CardAction data-testid='action'>
        <span>12%</span>
      </CardAction>
    </CardHeader>
  )
  const header = screen.getByTestId('header')
  const action = screen.getByTestId('action')
  expect(header).toHaveAttribute('data-slot', 'card-header')
  // The grid switch is keyed on the action's slot, so headers without an
  // action keep the plain column.
  expect(header).toHaveClass(
    'flex',
    'flex-col',
    'has-data-[slot=card-action]:grid'
  )
  expect(action).toHaveAttribute('data-slot', 'card-action')
  expect(action).toHaveClass('col-start-2', 'row-start-1', 'justify-self-end')
  expect(action).toHaveTextContent('12%')
})

it('CardTitle uses text-title, not the old text-2xl', () => {
  render(<CardTitle>Title</CardTitle>)
  const el = screen.getByText('Title')
  expect(el).toHaveClass('text-title')
  expect(el).not.toHaveClass('text-2xl')
})
