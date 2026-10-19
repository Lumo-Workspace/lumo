/** @jest-environment jsdom */

/**
 * LUM-1246 — Card is the one card surface: `asChild` puts the surface on a
 * semantic/interactive child, and CardTitle uses the app-sized `text-title`.
 */

import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { Card, CardTitle } from '@/components/ui/card'

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

it('CardTitle uses text-title, not the old text-2xl', () => {
  render(<CardTitle>Title</CardTitle>)
  const el = screen.getByText('Title')
  expect(el).toHaveClass('text-title')
  expect(el).not.toHaveClass('text-2xl')
})
