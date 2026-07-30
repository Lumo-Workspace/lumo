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

const MEMBERS = [{ actorId: 'u1', name: 'Ada', email: 'ada@example.com' }]
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useMembers', () => ({
  useMembers: () => ({ members: MEMBERS, agentActors: [] }),
}))

const mentionSourcesSpy = jest.fn((members: unknown) => ({ members }))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useMentionSources', () => ({
  useMentionSources: (members: unknown) => mentionSourcesSpy(members),
}))

// The real editor pulls the whole Tiptap stack. Stub the lazy wrapper the
// dialog imports with a textarea that reports the props the dialog passes, so
// the tests can assert *which* editor is mounted and what it is fed.
const editorProps: {
  placeholder?: string
  mentionSources?: unknown
  value?: string | null
} = {}
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/DescriptionEditorLazy',
  () => ({
    DescriptionEditor: (props: {
      value: string | null
      placeholder?: string
      mentionSources?: unknown
      onChange?: (html: string | null) => void
    }) => {
      Object.assign(editorProps, props)
      return (
        <textarea
          data-testid='description-editor'
          aria-label='Description'
          value={props.value ?? ''}
          placeholder={props.placeholder}
          onChange={e => props.onChange?.(e.target.value)}
        />
      )
    },
  })
)

import { render, screen, waitFor, fireEvent } from '@testing-library/react'
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

    // The name is borderless: no box, no focus ring (a text input matches
    // :focus-visible on a plain mouse click, so a ring here would box in
    // whichever line is being edited).
    expect(nameField().className).toContain('bg-transparent')
    expect(nameField().className).toContain('outline-none')
    expect(nameField().className).not.toMatch(/(^|\s)border/)
    expect(nameField().className).not.toContain('ring')

    // The description is the shared rich editor — the same one a task body
    // gets — fed the workspace members so @-mentions resolve to people.
    expect(screen.getByTestId('description-editor')).toBeInTheDocument()
    expect(mentionSourcesSpy).toHaveBeenCalledWith(MEMBERS)
    expect(editorProps.mentionSources).toEqual({ members: MEMBERS })

    // Both dates are chips, and both may be left empty.
    const start = screen.getByLabelText('Start date')
    const target = screen.getByLabelText('Target date')
    expect(start).toHaveAttribute('type', 'date')
    expect(target).toHaveAttribute('type', 'date')
    expect(start).toHaveValue('')
    expect(target).toHaveValue('')
    expect(start.closest('label')?.className).toContain('rounded-full')
    expect(target.closest('label')?.className).toContain('rounded-full')
    // Status is not part of this form in either mode — see the edit test.
    expect(screen.queryByLabelText('Status')).not.toBeInTheDocument()

    await userEvent.type(nameField(), 'Agent-Native Sprints')
    // The editor always keeps an empty paragraph around; a body that renders to
    // no text is stored as null rather than as markup.
    fireEvent.change(descriptionField(), { target: { value: '<p></p>' } })
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

  it('edits an existing milestone name, description and both dates, and offers no status control', async () => {
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

    // Status is edited on the detail page's sidebar, not here — the dialog
    // neither shows the control nor writes the field, so it can never save back
    // a value the sidebar has since moved on from.
    expect(screen.queryByLabelText('Status')).not.toBeInTheDocument()
    expect(screen.queryByText('Planned')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Save/ }))

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1))
    expect(updateMock).toHaveBeenCalledWith('ms_1', {
      name: 'Q4 Launch',
      description: 'Ship the other thing',
      startDate: '2026-10-01',
      targetDate: '2026-12-15',
    })
    expect(updateMock.mock.calls[0]?.[1]).not.toHaveProperty('status')
    expect(createMock).not.toHaveBeenCalled()
  })
})
