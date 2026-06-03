/** @jest-environment jsdom */
const en: Record<string, string> = {
  'task.field.milestone': 'Milestone',
  'task.field.milestone.none': 'No milestone',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => en[id] ?? id,
  }),
}))

let mockMilestones: Array<{
  id: string
  name: string
  status: string
  targetDate: string | null
}> = []

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useMilestones', () => ({
  useMilestones: jest.fn(() => ({ milestones: mockMilestones })),
}))

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useFormatDate', () => ({
  useFormatDate: () => ({ fmtDate: () => 'Jun 1' }),
}))

import { render, screen } from '@testing-library/react'
import { TaskMilestoneField } from '@/app/workspace/[workspaceUrl]/components/milestones/TaskMilestoneField'
import { useMilestones } from '@/app/workspace/[workspaceUrl]/hooks/useMilestones'

const useMilestonesMock = useMilestones as unknown as jest.Mock

function renderField(
  props: Partial<React.ComponentProps<typeof TaskMilestoneField>> = {}
) {
  return render(
    <TaskMilestoneField
      projectId='proj_1'
      value={null}
      onChange={jest.fn()}
      {...props}
    />
  )
}

describe('TaskMilestoneField', () => {
  beforeEach(() => {
    mockMilestones = []
    useMilestonesMock.mockClear()
  })

  // LUM-190: the option list is a client request the first paint doesn't
  // need — the trigger name comes from the SSR-prefetched object. The query
  // must stay disabled (enabled=false) until the dropdown is opened.
  it('keeps the option-list query disabled until the dropdown opens', () => {
    renderField({ value: 'ms_1', milestone: { id: 'ms_1', name: 'X' } })
    const calls = useMilestonesMock.mock.calls
    const lastCall = calls[calls.length - 1]
    expect(lastCall?.[2]).toBe(false)
  })

  // Regression guard for LUM-189: on first paint the client option list is
  // empty, so without the SSR-prefetched object the trigger would flash the
  // placeholder before the real name appears. The prefetched `milestone` prop
  // must render the name immediately.
  it('renders the prefetched milestone name when the option list is empty', () => {
    renderField({
      value: 'ms_1',
      milestone: { id: 'ms_1', name: 'Optimistic UI' },
    })
    expect(screen.getByText('Optimistic UI')).toBeInTheDocument()
    expect(screen.queryByText('Milestone')).not.toBeInTheDocument()
  })

  it('prefers the loaded option (with date) once milestones have loaded', () => {
    mockMilestones = [
      {
        id: 'ms_1',
        name: 'Optimistic UI',
        status: 'PLANNED',
        targetDate: '2026-06-01',
      },
    ]
    renderField({
      value: 'ms_1',
      milestone: { id: 'ms_1', name: 'stale name' },
    })
    expect(screen.getByText('Optimistic UI · Jun 1')).toBeInTheDocument()
    expect(screen.queryByText('stale name')).not.toBeInTheDocument()
  })

  it('shows the placeholder when no milestone is bound', () => {
    renderField({ value: null, milestone: null })
    expect(screen.getByText('Milestone')).toBeInTheDocument()
  })
})
