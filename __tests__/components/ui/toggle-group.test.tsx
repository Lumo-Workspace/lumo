/** LUM-1267: filter rows are single-select ToggleGroups in the chip variant. */
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  ToggleGroup,
  ToggleGroupItem,
  ToggleGroupItemCount,
} from '@/components/ui/toggle-group'

function Chips({ onChange }: { onChange: (v: string) => void }) {
  const [value, setValue] = useState('all')
  return (
    <ToggleGroup
      type='single'
      variant='chip'
      value={value}
      onValueChange={v => {
        if (!v) return
        setValue(v)
        onChange(v)
      }}
      aria-label='Filter'
    >
      <ToggleGroupItem value='all'>
        All <ToggleGroupItemCount>54</ToggleGroupItemCount>
      </ToggleGroupItem>
      <ToggleGroupItem value='open'>
        Open <ToggleGroupItemCount>3</ToggleGroupItemCount>
      </ToggleGroupItem>
    </ToggleGroup>
  )
}

it('renders pill chips that fill with primary when selected', () => {
  render(<Chips onChange={() => {}} />)
  const all = screen.getByRole('radio', { name: /All/ })
  expect(all).toHaveAttribute('aria-checked', 'true')
  expect(all).toHaveAttribute('data-state', 'on')
  expect(all).toHaveClass(
    'rounded-full',
    'border',
    'text-caption',
    'h-6',
    'data-[state=on]:bg-primary',
    'data-[state=on]:text-primary-foreground'
  )
  // The chip size wins over the default toggle size.
  expect(all).not.toHaveClass('h-9')
  expect(screen.getByText('54')).toHaveClass('opacity-70')
  expect(screen.getByRole('group', { name: 'Filter' })).toBeInTheDocument()
})

it('selects one chip at a time and never clears to nothing', () => {
  const onChange = jest.fn()
  render(<Chips onChange={onChange} />)
  const all = screen.getByRole('radio', { name: /All/ })
  const open = screen.getByRole('radio', { name: /Open/ })

  fireEvent.click(open)
  expect(onChange).toHaveBeenLastCalledWith('open')
  expect(open).toHaveAttribute('aria-checked', 'true')
  expect(all).toHaveAttribute('aria-checked', 'false')

  onChange.mockClear()
  fireEvent.click(open)
  expect(onChange).not.toHaveBeenCalled()
  expect(open).toHaveAttribute('aria-checked', 'true')
})
