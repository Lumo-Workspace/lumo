/** @jest-environment jsdom */
const en: Record<string, string> = {
  'memory.dialog.create.title': 'Add memory',
  'memory.dialog.edit.title': 'Edit memory',
  'memory.dialog.create.cta': 'Create',
  'memory.dialog.edit.cta': 'Save changes',
  'memory.dialog.cancel': 'Cancel',
  'memory.dialog.categoryStep': 'Choose a category',
  'memory.category.trap': 'Trap',
  'memory.category.decision': 'Decision',
  'memory.category.convention': 'Convention',
  'memory.category.procedural': 'Procedure',
  'memory.form.trap.trigger.label': 'Trigger',
  'memory.form.trap.outcome.label': 'Outcome',
  'memory.form.trap.workaround.label': 'Workaround',
  'memory.form.convention.rule.label': 'Rule',
  'memory.form.convention.scope.label': 'Where it applies',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => en[id] ?? id,
  }),
}))

import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryEditDialog } from '@/app/workspace/[workspaceUrl]/components/memory/MemoryEditDialog'

function renderDialog(props: Partial<React.ComponentProps<typeof MemoryEditDialog>> = {}) {
  return render(
    <MemoryEditDialog
      open
      mode='create'
      onOpenChange={() => {}}
      onSubmit={jest.fn()}
      submitting={false}
      {...props}
    />
  )
}

describe('MemoryEditDialog', () => {
  it('create mode shows the category step first', () => {
    renderDialog()
    expect(screen.getByText('Choose a category')).toBeInTheDocument()
  })

  it('selecting a category renders that form', () => {
    renderDialog()
    fireEvent.click(screen.getByText('Trap'))
    expect(screen.getByLabelText(/Trigger/)).toBeInTheDocument()
  })

  it('submit is disabled until required fields are filled, then calls onSubmit', () => {
    const onSubmit = jest.fn()
    renderDialog({ onSubmit })
    fireEvent.click(screen.getByText('Trap'))
    const submit = screen.getByRole('button', { name: 'Create' })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Trigger/), { target: { value: 'do X' } })
    fireEvent.change(screen.getByLabelText(/Outcome/), { target: { value: 'Y breaks' } })
    expect(submit).not.toBeDisabled()
    fireEvent.click(submit)
    expect(onSubmit).toHaveBeenCalledWith({ category: 'TRAP', content: { trigger: 'do X', outcome: 'Y breaks' } })
  })

  it('edit mode locks the category and prefills content', () => {
    renderDialog({
      mode: 'edit',
      editing: {
        id: 'm1',
        category: 'CONVENTION',
        content: { rule: 'use named exports', scope: 'all files' },
        scope: 'TASK',
        taskId: 't1',
        createdByMemberId: null,
        createdAt: '2026-05-01T00:00:00Z',
        updatedAt: '2026-05-01T00:00:00Z',
      },
      onSubmit: jest.fn(),
    })
    expect(screen.queryByText('Choose a category')).not.toBeInTheDocument()
    expect((screen.getByLabelText(/Rule/) as HTMLTextAreaElement).value).toBe('use named exports')
  })
})
