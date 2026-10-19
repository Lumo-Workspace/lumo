/** @jest-environment jsdom */
/**
 * LUM-1265: the shadcn RadioGroup primitive — one checked item per group,
 * label association by id, and arrow-key roving inside the group.
 */
import '@testing-library/jest-dom'
import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'

function Demo({ onChange }: { onChange: (v: string) => void }) {
  const [value, setValue] = useState('a')
  return (
    <RadioGroup
      aria-label='Pick one'
      value={value}
      onValueChange={v => {
        setValue(v)
        onChange(v)
      }}
    >
      {['a', 'b', 'c'].map(v => (
        <div key={v}>
          <RadioGroupItem id={`opt-${v}`} value={v} />
          <label htmlFor={`opt-${v}`}>Option {v}</label>
        </div>
      ))}
    </RadioGroup>
  )
}

const checked = () =>
  screen
    .getAllByRole('radio')
    .filter(r => r.getAttribute('aria-checked') === 'true')
    .map(r => r.id)

it('renders a labelled group with exactly one checked item', () => {
  render(<Demo onChange={jest.fn()} />)
  expect(
    screen.getByRole('radiogroup', { name: 'Pick one' })
  ).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: 'Option a' })).toBeInTheDocument()
  expect(checked()).toEqual(['opt-a'])
})

it('checks the item whose label is clicked', () => {
  const onChange = jest.fn()
  render(<Demo onChange={onChange} />)
  fireEvent.click(screen.getByText('Option c'))
  expect(onChange).toHaveBeenCalledWith('c')
  expect(checked()).toEqual(['opt-c'])
})

it('moves the choice with the arrow keys', async () => {
  const onChange = jest.fn()
  render(<Demo onChange={onChange} />)
  screen.getByRole('radio', { name: 'Option a' }).focus()
  // Held, as a person presses it: Radix moves focus on a timer and checks the
  // newly focused item only while the arrow key is still down.
  await userEvent.keyboard('{ArrowDown>}')
  await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('b'))
  await userEvent.keyboard('{/ArrowDown}')
  expect(checked()).toEqual(['opt-b'])
})
