/** LUM-1267: key hints render through one Kbd primitive. */
import { render, screen } from '@testing-library/react'
import { Kbd, KbdGroup } from '@/components/ui/kbd'

it('renders a <kbd> on the muted chip by default', () => {
  render(<Kbd>⌘K</Kbd>)
  const kbd = screen.getByText('⌘K')
  expect(kbd.tagName).toBe('KBD')
  expect(kbd).toHaveAttribute('data-slot', 'kbd')
  expect(kbd).toHaveClass('bg-muted', 'text-caption', 'font-sans')
})

it('tints from the surface text colour on a filled button', () => {
  render(<Kbd variant='solid'>↵</Kbd>)
  const kbd = screen.getByText('↵')
  expect(kbd).toHaveClass('bg-current/15')
  expect(kbd).not.toHaveClass('bg-muted')
})

it('groups several keys', () => {
  render(
    <KbdGroup>
      <Kbd>Ctrl</Kbd>
      <Kbd>↵</Kbd>
    </KbdGroup>
  )
  expect(screen.getByText('Ctrl').parentElement).toHaveAttribute(
    'data-slot',
    'kbd-group'
  )
})
