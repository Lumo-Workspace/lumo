/** @jest-environment jsdom */
const en: Record<string, string> = {
  'memory.action.edit': 'Edit',
  'memory.action.promote': 'Promote to project',
  'memory.action.delete': 'Delete',
  'memory.action.menu': 'Memory actions',
  'memory.source.auto': 'Sedimented by Claude',
  'memory.source.byMember': 'Added by {name}',
  'memory.delete.confirm.title': 'Delete this memory?',
  'memory.delete.confirm.body': "This can't be undone.",
  'memory.dialog.cancel': 'Cancel',
  'memory.category.trap': 'Trap',
  'taskArtifact.agent.CLAUDE_CODE': 'Claude Code',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }, values?: Record<string, unknown>) =>
      (en[id] ?? id).replace(/\{(\w+)\}/g, (_, k) => String(values?.[k] ?? '')),
  }),
}))

import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryListItem } from '@/app/workspace/[workspaceUrl]/components/memory/MemoryListItem'
import type { MemoryRow } from '@/lib/api-client'

const baseRow: MemoryRow = {
  id: 'm1',
  scope: 'TASK',
  category: 'TRAP',
  agent: 'CLAUDE_CODE',
  content: { trigger: 'do X', outcome: 'Y breaks' },
  taskId: 't1',
  createdByMemberId: null,
  createdAt: '2026-05-01T00:00:00Z',
  updatedAt: '2026-05-01T00:00:00Z',
}

function setup(
  overrides: Partial<React.ComponentProps<typeof MemoryListItem>> = {}
) {
  const onEdit = jest.fn(),
    onPromote = jest.fn(),
    onDelete = jest.fn()
  render(
    <MemoryListItem
      memory={baseRow}
      canPromote
      onEdit={onEdit}
      onPromote={onPromote}
      onDelete={onDelete}
      {...overrides}
    />
  )
  return { onEdit, onPromote, onDelete }
}

/** Open the Radix DropdownMenu.
 *  userEvent.click includes the full pointer event sequence (pointerover,
 *  pointerenter, mouseover, mouseenter, pointermove, mousemove, pointerdown,
 *  mousedown, pointerup, mouseup, click) that Radix listens for. */
async function openMenu() {
  const user = userEvent.setup()
  const trigger = screen.getByRole('button', { name: 'Memory actions' })
  await user.click(trigger)
}

describe('MemoryListItem', () => {
  it('renders the memory card content', () => {
    setup()
    expect(screen.getByText('do X')).toBeInTheDocument()
  })

  it('uses summary as the title and demotes the headline field to a section', () => {
    setup({
      memory: {
        ...baseRow,
        content: {
          summary: 'Hook fires on failure',
          trigger: 'do X',
          outcome: 'Y breaks',
        },
      },
    })
    // summary becomes the card title…
    expect(screen.getByText('Hook fires on failure')).toBeInTheDocument()
    // …and the full trigger sentence is still rendered, now as a body section.
    expect(screen.getByText('do X')).toBeInTheDocument()
  })

  it('shows AgentBadge label for auto-sedimented memories (no old auto text)', () => {
    setup({ memory: { ...baseRow, createdByMemberId: null, agent: 'CLAUDE_CODE' } })
    // AgentBadge renders the agent label
    expect(screen.getByText('Claude Code')).toBeInTheDocument()
    // old auto string must not appear
    expect(screen.queryByText('Sedimented by Claude')).not.toBeInTheDocument()
    // zh-CN variant also absent
    expect(screen.queryByText('由 Claude 沉淀')).not.toBeInTheDocument()
  })

  it('shows "Added by <name>" for human-created memories', () => {
    setup({
      memory: { ...baseRow, createdByMemberId: 'mem1' },
      memberName: 'Alice',
    })
    expect(screen.getByText('Added by Alice')).toBeInTheDocument()
  })

  it('opens the menu and fires onEdit', async () => {
    const { onEdit } = setup()
    await openMenu()
    fireEvent.click(screen.getByText('Edit'))
    expect(onEdit).toHaveBeenCalledWith(baseRow)
  })

  it('shows Promote only when canPromote', async () => {
    setup({ canPromote: false })
    await openMenu()
    expect(screen.queryByText('Promote to project')).not.toBeInTheDocument()
  })

  it('delete goes through the confirm dialog then calls onDelete', async () => {
    const { onDelete } = setup()
    await openMenu()
    fireEvent.click(screen.getByText('Delete'))
    // Confirm dialog appears; click its destructive action (the second "Delete")
    const confirm = screen.getByText('Delete this memory?')
    expect(confirm).toBeInTheDocument()
    const deletes = screen.getAllByText('Delete')
    const lastDelete = deletes[deletes.length - 1]
    if (!lastDelete) throw new Error('Delete button not found')
    fireEvent.click(lastDelete)
    expect(onDelete).toHaveBeenCalledWith(baseRow)
  })
})
