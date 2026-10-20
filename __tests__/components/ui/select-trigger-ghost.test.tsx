/** @jest-environment jsdom */
// LUM-1274: SelectTrigger gained a `ghost` variant (+ `sm` size) for inline
// property values, and the task-field selects accept `variant='ghost'`. The
// default look must stay exactly as before for every other surface (OCP).
const en: Record<string, string> = {
  'task.status': 'Status',
  'task.priority': 'Priority',
  'status.inProgress': 'In Progress',
  'priority.high': 'High',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => en[id] ?? id,
  }),
}))

import { render, screen } from '@testing-library/react'
import { Select, SelectTrigger } from '@/components/ui/select'
import { StatusSelect } from '@/app/workspace/[workspaceUrl]/components/fields/StatusSelect'
import { PrioritySelect } from '@/app/workspace/[workspaceUrl]/components/fields/PrioritySelect'
import { fieldTriggerProps } from '@/app/workspace/[workspaceUrl]/components/fields/shared'

function trigger(variant?: 'default' | 'ghost', size?: 'default' | 'sm') {
  render(
    <Select>
      <SelectTrigger variant={variant} size={size}>
        value
      </SelectTrigger>
    </Select>
  )
  return screen.getByRole('combobox')
}

describe('SelectTrigger variants', () => {
  it('keeps the bordered h-9 control by default', () => {
    const el = trigger()
    expect(el.className).toContain('border-border')
    expect(el.className).toContain('shadow-elevation-1')
    expect(el.className).toContain('h-9')
  })

  it('ghost + sm drops border and shadow, uses the control-sm row and hides the chevron until hover', () => {
    const el = trigger('ghost', 'sm')
    expect(el.className).toContain('border-transparent')
    expect(el.className).toContain('shadow-none')
    expect(el.className).toContain('hover:bg-accent')
    expect(el.className).toContain('h-control-sm')
    expect(el.className).not.toContain('border-border')
    expect(el.className).not.toContain('h-9')
    expect(el.className).toContain('[&>svg:last-child]:opacity-0')
    expect(el.className).toContain('hover:[&>svg:last-child]:opacity-50')
  })
})

describe('fieldTriggerProps', () => {
  it('maps a field variant to SelectTrigger variant/size', () => {
    expect(fieldTriggerProps()).toEqual({ variant: 'default', size: 'default' })
    expect(fieldTriggerProps('default')).toEqual({
      variant: 'default',
      size: 'default',
    })
    expect(fieldTriggerProps('ghost')).toEqual({ variant: 'ghost', size: 'sm' })
  })
})

describe('task-field selects with variant="ghost"', () => {
  it('StatusSelect renders a ghost trigger and leaves the default untouched', () => {
    const { unmount } = render(
      <StatusSelect value='IN_PROGRESS' onChange={jest.fn()} variant='ghost' />
    )
    expect(screen.getByRole('combobox').className).toContain(
      'border-transparent'
    )
    unmount()
    render(<StatusSelect value='IN_PROGRESS' onChange={jest.fn()} />)
    expect(screen.getByRole('combobox').className).toContain('border-border')
  })

  it('PrioritySelect renders a ghost trigger', () => {
    render(<PrioritySelect value='HIGH' onChange={jest.fn()} variant='ghost' />)
    const el = screen.getByRole('combobox')
    expect(el.className).toContain('h-control-sm')
    expect(el).toHaveTextContent('High')
  })
})
