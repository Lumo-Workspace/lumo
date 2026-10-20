/** @jest-environment jsdom */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

// LUM-1284 — in the web new-task modal the AI priority suggestion is only a
// hint next to the priority field: the field stays NONE until the user picks a
// value or clicks the hint, and the hint goes away once a value is picked.
// The modal and AiPrioritySelect render for real; heavy children, data hooks
// and the Radix primitives are replaced with plain stand-ins.

jest.mock('react-intl', () => {
  const fmt = (
    { id }: { id: string },
    values?: Record<string, string | number>
  ) => (values ? `${id}:${Object.values(values).join('/')}` : id)
  const intl = { locale: 'en-US', formatMessage: fmt }
  return { useIntl: () => intl }
})

jest.mock('next/navigation', () => ({
  useParams: () => ({ workspaceUrl: 'test-workspace' }),
}))

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))

jest.mock('@/lib/api-client', () => ({
  apiFetch: jest.fn(async () => ({ matches: [] })),
}))

// The suggestion hook is driven per test through this module-level value.
type MockSuggestion = {
  priority: string
  reason: string
  stats: { total: number; distribution: Record<string, number> }
  similarTasks: never[]
} | null
let mockSuggestion: MockSuggestion = null
const mockNoop = () => {}
jest.mock('@/app/workspace/[workspaceUrl]/hooks/usePrioritySuggestion', () => ({
  usePrioritySuggestion: () => ({
    suggestion: mockSuggestion,
    isLoading: false,
    onTitleChange: mockNoop,
    onDescriptionChange: mockNoop,
    reset: mockNoop,
  }),
}))

const mockRecovery = {
  recovered: null,
  save: mockNoop,
  clear: mockNoop,
  acceptRecovery: () => null,
  discardRecovery: mockNoop,
}
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useFormRecovery', () => ({
  useFormRecovery: () => mockRecovery,
}))
const mockNoMatches = { clientMatches: [] }
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useDuplicateCheck', () => ({
  useDuplicateCheck: () => mockNoMatches,
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useMentionSources', () => ({
  useMentionSources: () => undefined,
}))

jest.mock('@/app/workspace/[workspaceUrl]/components/FormDialog', () => ({
  FormDialog: ({
    children,
    footer,
  }: {
    children: React.ReactNode | ((expanded: boolean) => React.ReactNode)
    footer?: React.ReactNode
  }) => (
    <div>
      {typeof children === 'function' ? children(false) : children}
      {footer}
    </div>
  ),
}))
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/DescriptionEditorLazy',
  () => ({ DescriptionEditor: () => null })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/AiDescriptionPrompt',
  () => ({
    AiDescriptionPrompt: () => null,
  })
)
jest.mock('@/app/workspace/[workspaceUrl]/components/DuplicateWarning', () => ({
  DuplicateWarning: () => null,
}))
jest.mock('@/app/workspace/[workspaceUrl]/components/DuplicateConfirm', () => ({
  DuplicateConfirm: () => null,
}))
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/FormRecoveryBanner',
  () => ({
    FormRecoveryBanner: () => null,
  })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/fields/StatusSelect',
  () => ({
    StatusSelect: () => null,
  })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/fields/ProjectSelect',
  () => ({
    ProjectSelect: () => null,
  })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/fields/AssigneeSelect',
  () => ({
    AssigneeSelect: () => null,
  })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/fields/SprintSelect',
  () => ({
    SprintSelect: () => null,
  })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/fields/DueDatePicker',
  () => ({
    DueDatePicker: () => null,
  })
)

jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipContent: () => null,
}))
// A native <select> stands in for the Radix Select so a manual pick is one
// change event.
jest.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string
    onValueChange: (v: string) => void
    children: React.ReactNode
  }) => (
    <select
      aria-label='priority-select'
      value={value}
      onChange={e => onValueChange(e.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  SelectItem: ({ value }: { value: string }) => (
    <option value={value}>{value}</option>
  ),
}))

import { NewTaskModal } from '@/app/workspace/[workspaceUrl]/components/modals/NewTaskModal'

const HIGH_SUGGESTION: MockSuggestion = {
  priority: 'HIGH',
  reason: 'Blocks checkout',
  stats: { total: 0, distribution: {} },
  similarTasks: [],
}

function renderModal() {
  const onSubmit = jest.fn(async () => {})
  render(
    <NewTaskModal
      isOpen
      onClose={mockNoop}
      projects={[]}
      members={[]}
      defaultProjectId='p1'
      onSubmit={onSubmit}
    />
  )
  return { onSubmit }
}

const prioritySelect = () =>
  screen.getByLabelText('priority-select') as HTMLSelectElement
const hint = () =>
  screen.queryByRole('button', {
    name: 'priority.applyAiSuggestion:priority.high',
  })

async function submitWithTitle(title: string) {
  fireEvent.change(screen.getByPlaceholderText('newTask.titlePlaceholder'), {
    target: { value: title },
  })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /newTask\.create/ }))
  })
}

describe('NewTaskModal AI priority hint (LUM-1284)', () => {
  beforeEach(() => {
    mockSuggestion = HIGH_SUGGESTION
  })

  it('keeps the field at NONE and shows the suggestion only as a hint', () => {
    renderModal()
    expect(prioritySelect().value).toBe('NONE')
    const button = hint()
    expect(button).toBeInTheDocument()
    expect(button).toHaveTextContent('priority.aiSuggests')
    expect(button).toHaveTextContent('priority.high')
    expect(screen.getByTestId('priority-dot-high')).toBeInTheDocument()
  })

  it('clicking the hint applies the suggested value and hides the hint', () => {
    renderModal()
    fireEvent.click(hint()!)
    expect(prioritySelect().value).toBe('HIGH')
    expect(hint()).not.toBeInTheDocument()
  })

  it('picking a value manually hides the hint', () => {
    renderModal()
    fireEvent.change(prioritySelect(), { target: { value: 'LOW' } })
    expect(prioritySelect().value).toBe('LOW')
    expect(hint()).not.toBeInTheDocument()
  })

  it('submitting without touching the field sends NONE and no AI value', async () => {
    const { onSubmit } = renderModal()
    await submitWithTitle('Fix checkout')
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Fix checkout',
        priority: 'NONE',
        aiSuggestedPriority: null,
      })
    )
  })

  it('a manual pick that differs from the hint is reported as an override', async () => {
    const { onSubmit } = renderModal()
    fireEvent.change(prioritySelect(), { target: { value: 'LOW' } })
    await submitWithTitle('Fix checkout')
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ priority: 'LOW', aiSuggestedPriority: 'HIGH' })
    )
  })

  it('shows no hint without a suggestion', () => {
    mockSuggestion = null
    renderModal()
    expect(prioritySelect().value).toBe('NONE')
    expect(
      screen.queryByRole('button', { name: /priority\.applyAiSuggestion/ })
    ).not.toBeInTheDocument()
  })
})
