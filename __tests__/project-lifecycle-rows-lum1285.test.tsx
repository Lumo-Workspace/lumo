/** @jest-environment jsdom */
/**
 * LUM-1285: the project page's Status / Dates rows and the sidebar's
 * archived-project filter.
 */

jest.mock('react-intl', () => {
  const en = require('@/lib/i18n/en.json') as Record<string, string>
  return {
    useIntl: () => ({
      locale: 'en',
      formatMessage: ({ id }: { id: string }) => en[id] ?? id,
    }),
  }
})

// Radix Select / the calendar popover need portals and pointer capture; the
// assertions are about what each control is handed and reports back.
jest.mock('@/app/workspace/[workspaceUrl]/components/fields', () => ({
  FIELD_TRIGGER_CLS: '',
  ProjectStatusSelect: ({
    value,
    onChange,
  }: {
    value: string
    onChange: (v: string) => void
  }) => (
    <select
      data-testid='status-select'
      value={value}
      onChange={e => onChange(e.target.value)}
    >
      <option value='ACTIVE'>Active</option>
      <option value='PAUSED'>Paused</option>
      <option value='CANCELED'>Canceled</option>
    </select>
  ),
}))
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/fields/CalendarDayPicker',
  () => ({
    CalendarDayPicker: ({
      value,
      onChange,
      min,
      max,
      'aria-label': label,
    }: {
      value: string
      onChange: (v: string) => void
      min?: string
      max?: string
      'aria-label'?: string
    }) => (
      <input
        aria-label={label}
        data-min={min ?? ''}
        data-max={max ?? ''}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    ),
  })
)

import { fireEvent, render, screen } from '@testing-library/react'
import { ProjectLifecycleRows } from '@/app/workspace/[workspaceUrl]/components/pages/project-detail/ProjectLifecycleRows'
import { isSidebarProject } from '@/app/workspace/[workspaceUrl]/utils/projectVisibility'

function setup(overrides: Partial<Parameters<typeof ProjectLifecycleRows>[0]>) {
  const onChange = jest.fn()
  render(
    <ProjectLifecycleRows
      status='ACTIVE'
      startDate={null}
      targetDate={null}
      completed={false}
      archived={false}
      onChange={onChange}
      {...overrides}
    />
  )
  return onChange
}

describe('ProjectLifecycleRows', () => {
  it('reports a status change as a single-field patch', () => {
    const onChange = setup({})
    fireEvent.change(screen.getByTestId('status-select'), {
      target: { value: 'PAUSED' },
    })
    expect(onChange).toHaveBeenCalledWith({ status: 'PAUSED' })
  })

  it('shows derived completion and the archived badge only when true', () => {
    setup({ completed: true, archived: true })
    expect(screen.getByText('Completed')).toBeTruthy()
    expect(screen.getByText('Archived')).toBeTruthy()
  })

  it('hides both badges otherwise', () => {
    setup({})
    expect(screen.queryByText('Completed')).toBeNull()
    expect(screen.queryByText('Archived')).toBeNull()
  })

  it('bounds the pickers by each other and clears with null', () => {
    const onChange = setup({
      startDate: '2026-11-01T00:00:00.000Z',
      targetDate: '2026-12-01T00:00:00.000Z',
    })
    const start = screen.getByLabelText('Start')
    const target = screen.getByLabelText('Target')
    expect(start.getAttribute('data-max')).toBe('2026-12-01')
    expect(target.getAttribute('data-min')).toBe('2026-11-01')
    fireEvent.change(target, { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith({ targetDate: null })
    fireEvent.change(start, { target: { value: '2026-11-05' } })
    expect(onChange).toHaveBeenCalledWith({ startDate: '2026-11-05' })
  })
})

describe('isSidebarProject', () => {
  it('drops idea drafts and archived projects', () => {
    expect(isSidebarProject({ isIdea: false, archivedAt: null })).toBe(true)
    expect(isSidebarProject({ isIdea: false })).toBe(true)
    expect(isSidebarProject({ isIdea: true, archivedAt: null })).toBe(false)
    expect(
      isSidebarProject({ isIdea: false, archivedAt: '2026-10-01T00:00:00Z' })
    ).toBe(false)
  })
})
