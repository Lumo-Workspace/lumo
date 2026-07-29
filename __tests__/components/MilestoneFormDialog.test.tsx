/** @jest-environment jsdom */

const en: Record<string, string> = {
  'milestone.new': 'New milestone',
  'milestone.edit': 'Edit milestone',
  'milestone.field.name': 'Name',
  'milestone.field.description': 'Description',
  'milestone.field.status': 'Status',
  'milestone.field.startDate': 'Start date',
  'milestone.field.targetDate': 'Target date',
  'milestone.dates.start': 'Start',
  'milestone.dates.target': 'Target',
  'milestone.dialog.name.placeholder':
    'Milestone name, e.g. Agent-Native Sprints',
  'milestone.dialog.description.placeholder':
    'What should this milestone achieve? What are the deliverables and the bar for done? (optional)',
  'milestone.dialog.dates.optional': 'Both optional',
  'milestone.status.PLANNED': 'Planned',
  'milestone.status.ACTIVE': 'Active',
  'milestone.status.COMPLETED': 'Completed',
  'milestone.status.CANCELLED': 'Cancelled',
  'milestone.save.error': "Couldn't save milestone. Please try again.",
  'common.cancel': 'Cancel',
  'common.create': 'Create',
  'common.creating': 'Creating…',
  'common.save': 'Save',
  'common.saving': 'Saving…',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => en[id] ?? id,
  }),
}))

const createMock = jest.fn()
const updateMock = jest.fn()

jest.mock('@/lib/api-client', () => ({
  milestonesClient: {
    create: (...args: unknown[]) => createMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
  },
}))

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MilestoneFormDialog } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneFormDialog'
import { submitModLabel } from '@/lib/utils/keyboard'
import type { ApiMilestone } from '@/lib/api-client'

// Radix's Select and dismissable-layer internals reach for browser APIs jsdom
// does not implement.
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
  Element.prototype.scrollIntoView = jest.fn()
  Element.prototype.hasPointerCapture = jest.fn(() => false)
  Element.prototype.releasePointerCapture = jest.fn()
  Element.prototype.setPointerCapture = jest.fn()
})

function milestone(overrides: Partial<ApiMilestone> = {}): ApiMilestone {
  return {
    id: 'ms_1',
    projectId: 'proj_1',
    name: 'Q3 Launch',
    slug: 'q3-launch',
    description: 'Ship the thing',
    status: 'PLANNED',
    startDate: '2026-08-01T00:00:00.000Z',
    targetDate: '2026-09-30T00:00:00.000Z',
    completedAt: null,
    archivedAt: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  } as ApiMilestone
}

function renderDialog(props: Partial<{ milestone: ApiMilestone }> = {}) {
  const qc = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  const onClose = jest.fn()
  render(
    <QueryClientProvider client={qc}>
      <MilestoneFormDialog
        projectId='proj_1'
        milestone={props.milestone}
        onClose={onClose}
      />
    </QueryClientProvider>
  )
  return { onClose }
}

const nameField = () => screen.getByLabelText('Name')
const descriptionField = () => screen.getByLabelText('Description')

beforeEach(() => {
  createMock.mockReset().mockResolvedValue({ id: 'ms_new' })
  updateMock.mockReset().mockResolvedValue({ id: 'ms_1' })
})

describe('MilestoneFormDialog', () => {
  it('renders the create dialog as a document-style form without field labels', async () => {
    renderDialog()

    expect(
      screen.getByRole('heading', { name: 'New milestone' })
    ).toBeInTheDocument()

    // The fields carry their ask in the placeholder and their accessible name
    // in aria-label — no visible label text sits above them.
    expect(nameField()).toHaveAttribute(
      'placeholder',
      'Milestone name, e.g. Agent-Native Sprints'
    )
    expect(descriptionField()).toHaveAttribute(
      'placeholder',
      'What should this milestone achieve? What are the deliverables and the bar for done? (optional)'
    )
    for (const word of ['Name', 'Description', 'Start date', 'Target date']) {
      expect(screen.queryByText(word)).not.toBeInTheDocument()
    }

    // Borderless and self-sizing: no box, no scrollbar, no resize grip, and no
    // focus ring (a text input matches :focus-visible on a plain mouse click,
    // so a ring here would box in whichever line is being edited).
    for (const field of [nameField(), descriptionField()]) {
      expect(field.className).toContain('bg-transparent')
      expect(field.className).toContain('outline-none')
      expect(field.className).not.toMatch(/(^|\s)border/)
      expect(field.className).not.toContain('ring')
    }
    expect(descriptionField().className).toContain('resize-none')
    expect(descriptionField().className).toContain('overflow-hidden')

    // Both dates are chips, and both may be left empty.
    const start = screen.getByLabelText('Start date')
    const target = screen.getByLabelText('Target date')
    expect(start).toHaveAttribute('type', 'date')
    expect(target).toHaveAttribute('type', 'date')
    expect(start).toHaveValue('')
    expect(target).toHaveValue('')
    expect(start.closest('label')?.className).toContain('rounded-full')
    expect(target.closest('label')?.className).toContain('rounded-full')
    expect(screen.getByText('Both optional')).toBeInTheDocument()
    // Status is an edit-mode affordance: a milestone is always created PLANNED.
    expect(screen.queryByLabelText('Status')).not.toBeInTheDocument()

    await userEvent.type(nameField(), 'Agent-Native Sprints')
    await userEvent.click(screen.getByRole('button', { name: /Create/ }))

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1))
    expect(createMock).toHaveBeenCalledWith('proj_1', {
      name: 'Agent-Native Sprints',
      description: null,
      startDate: null,
      targetDate: null,
    })
  })

  it('submits on the platform submit shortcut and refuses an empty name', async () => {
    renderDialog()

    const cta = screen.getByRole('button', { name: /Create/ })
    // The shortcut is advertised on the CTA, in the current platform's notation.
    expect(cta).toHaveTextContent(`${submitModLabel}↵`)

    // Nothing to save yet: the CTA is disabled and the shortcut is inert.
    expect(cta).toBeDisabled()
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    expect(createMock).not.toHaveBeenCalled()

    await userEvent.type(nameField(), 'Agent-Native Sprints')

    // Enter alone stays a newline — the description is a paragraph.
    await userEvent.keyboard('{Enter}')
    expect(createMock).not.toHaveBeenCalled()

    await userEvent.keyboard(
      submitModLabel === '⌘'
        ? '{Meta>}{Enter}{/Meta}'
        : '{Control>}{Enter}{/Control}'
    )

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1))
    expect(createMock).toHaveBeenCalledWith(
      'proj_1',
      expect.objectContaining({ name: 'Agent-Native Sprints' })
    )
  })

  it('edits an existing milestone including status and both dates', async () => {
    renderDialog({ milestone: milestone() })

    expect(
      screen.getByRole('heading', { name: 'Edit milestone' })
    ).toBeInTheDocument()
    expect(nameField()).toHaveValue('Q3 Launch')
    expect(descriptionField()).toHaveValue('Ship the thing')
    expect(screen.getByLabelText('Start date')).toHaveValue('2026-08-01')
    expect(screen.getByLabelText('Target date')).toHaveValue('2026-09-30')

    await userEvent.clear(nameField())
    await userEvent.type(nameField(), 'Q4 Launch')
    await userEvent.clear(descriptionField())
    await userEvent.type(descriptionField(), 'Ship the other thing')

    const start = screen.getByLabelText('Start date') as HTMLInputElement
    const target = screen.getByLabelText('Target date') as HTMLInputElement
    await userEvent.clear(start)
    await userEvent.type(start, '2026-10-01')
    await userEvent.clear(target)
    await userEvent.type(target, '2026-12-15')

    await userEvent.click(screen.getByLabelText('Status'))
    await userEvent.click(screen.getByRole('option', { name: 'Active' }))

    await userEvent.click(screen.getByRole('button', { name: /Save/ }))

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1))
    expect(updateMock).toHaveBeenCalledWith('ms_1', {
      name: 'Q4 Launch',
      description: 'Ship the other thing',
      status: 'ACTIVE',
      startDate: '2026-10-01',
      targetDate: '2026-12-15',
    })
    expect(createMock).not.toHaveBeenCalled()
  })
})
