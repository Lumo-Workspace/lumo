/** @jest-environment jsdom */
const en: Record<string, string> = {
  'memory.dialog.create.title': 'Add memory',
  'memory.dialog.edit.title': 'Edit memory',
  'memory.dialog.create.cta': 'Create',
  'memory.dialog.edit.cta': 'Save changes',
  'memory.dialog.cancel': 'Cancel',
  'memory.dialog.shortcutHint': 'Cmd/Ctrl + Enter to save',
  'memory.field.summary.label': 'Title',
  'memory.category.trap': 'Trap',
  'memory.category.decision': 'Decision',
  'memory.category.convention': 'Convention',
  'memory.category.procedural': 'Procedure',
  'memory.section.trigger': 'Trigger',
  'memory.section.outcome': 'Outcome',
  'memory.section.workaround': 'Workaround',
  'memory.section.what': 'Decision',
  'memory.section.why': 'Why',
  'memory.section.alternatives': 'Alternatives considered',
  'memory.section.implications': 'Implications',
  'memory.section.rule': 'Rule',
  'memory.section.scope': 'Scope',
  'memory.section.workflow': 'Workflow',
  'memory.section.steps': 'Steps',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => en[id] ?? id,
  }),
}))

import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryEditDialog } from '@/app/workspace/[workspaceUrl]/components/memory/MemoryEditDialog'

function renderDialog(
  props: Partial<React.ComponentProps<typeof MemoryEditDialog>> = {}
) {
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

/** The pill is a button; the field label with the same word (e.g. "Decision")
 *  is a label, so query by role to disambiguate. */
const pill = (name: string) => screen.getByRole('button', { name })

describe('MemoryEditDialog', () => {
  it('renders category pills and the selected category fields together on open', () => {
    renderDialog()

    // All four categories are offered as pills…
    for (const name of ['Trap', 'Decision', 'Convention', 'Procedure']) {
      expect(pill(name)).toBeInTheDocument()
    }
    // …and TRAP's fields are already on screen — there is no separate
    // "choose a category" step to click through first.
    expect(pill('Trap')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText(/Trigger/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Outcome/)).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toBeInTheDocument()
  })

  it('switching category swaps the field set and gates save on required fields', () => {
    renderDialog()
    const submit = screen.getByRole('button', { name: 'Create' })
    expect(submit).toBeDisabled()

    fireEvent.click(pill('Convention'))

    // CONVENTION's fields replace TRAP's.
    expect(screen.getByLabelText(/Rule/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Scope/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/Trigger/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Outcome/)).not.toBeInTheDocument()

    // Save stays gated on the new category's required fields.
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Rule/), {
      target: { value: 'keep the branch' },
    })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Scope/), {
      target: { value: 'every PR' },
    })
    expect(submit).not.toBeDisabled()
  })

  // Name kept free of regex metacharacters — it is addressed by `jest -t`
  // from the acceptance contract, where a literal `+` would silently match
  // nothing.
  it('submits on meta enter only when required fields are filled', () => {
    const onSubmit = jest.fn()
    renderDialog({ onSubmit })

    const trigger = screen.getByLabelText(/Trigger/)

    // Required fields missing → the shortcut is a no-op.
    fireEvent.keyDown(trigger, { key: 'Enter', metaKey: true })
    expect(onSubmit).not.toHaveBeenCalled()

    fireEvent.change(trigger, { target: { value: 'do X' } })
    fireEvent.change(screen.getByLabelText(/Outcome/), {
      target: { value: 'Y breaks' },
    })

    // Plain Enter stays a newline — fields are paragraphs.
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()

    fireEvent.keyDown(trigger, { key: 'Enter', metaKey: true })
    expect(onSubmit).toHaveBeenCalledWith({
      category: 'TRAP',
      content: { trigger: 'do X', outcome: 'Y breaks' },
    })
  })

  it('edit mode prefills content and pins the category', () => {
    renderDialog({
      mode: 'edit',
      editing: {
        id: 'm1',
        category: 'CONVENTION',
        agent: 'CLAUDE_CODE',
        content: { rule: 'use named exports', scope: 'all files' },
        scope: 'TASK',
        taskId: 't1',
        createdByMemberId: null,
        createdAt: '2026-05-01T00:00:00Z',
        updatedAt: '2026-05-01T00:00:00Z',
      },
      onSubmit: jest.fn(),
    })

    expect((screen.getByLabelText(/Rule/) as HTMLTextAreaElement).value).toBe(
      'use named exports'
    )
    expect((screen.getByLabelText(/Scope/) as HTMLTextAreaElement).value).toBe(
      'all files'
    )

    // The category reads as a static chip: no pill is clickable, so the
    // content shape can never drift away from the stored category.
    expect(screen.getByText('Convention')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Convention' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Trap' })).toBeNull()

    // The title is focused with the caret collapsed at the end — NOT with its
    // value selected, which would let the first keystroke wipe the title.
    const title = screen.getByLabelText('Title') as HTMLInputElement
    expect(document.activeElement).toBe(title)
    expect(title.selectionStart).toBe(title.value.length)
    expect(title.selectionEnd).toBe(title.value.length)
  })

  it('keeps summary optional and maps PROCEDURAL steps one per line', () => {
    const onSubmit = jest.fn()
    renderDialog({ onSubmit })

    fireEvent.click(pill('Procedure'))
    fireEvent.change(screen.getByLabelText(/Workflow/), {
      target: { value: 'assemble context' },
    })
    fireEvent.change(screen.getByLabelText(/Trigger/), {
      target: { value: 'at session start' },
    })
    fireEvent.change(screen.getByLabelText(/Steps/), {
      target: { value: 'read memory\n\nread the contract\n' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    // No summary typed → it is omitted from the payload entirely, and the
    // steps paragraph becomes an array with blank lines dropped.
    expect(onSubmit).toHaveBeenCalledWith({
      category: 'PROCEDURAL',
      content: {
        workflow: 'assemble context',
        trigger: 'at session start',
        steps: ['read memory', 'read the contract'],
      },
    })
  })
})
