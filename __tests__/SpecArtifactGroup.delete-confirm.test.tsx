/** @jest-environment jsdom */

// i18n: map only the keys this component touches; everything else falls back to its id.
const MESSAGES: Record<string, string> = {
  'taskArtifact.delete': 'Delete',
  'taskArtifact.cancel': 'Cancel',
  'taskArtifact.edit': 'Edit',
  'taskArtifact.deleteConfirmTitle': 'Delete artifact?',
  'taskArtifact.deleteConfirmDesc':
    'This artifact will be permanently removed. This action cannot be undone.',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => MESSAGES[id] ?? id,
    formatDate: () => '6/15, 12:00 PM',
  }),
}))

// The badges are irrelevant here — stub them out.
jest.mock('@/app/workspace/[workspaceUrl]/components/AgentBadge', () => ({
  AgentBadge: () => null,
  AgentAvatar: () => null,
}))

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useArtifacts', () => ({
  useArtifacts: jest.fn(),
}))

import { render, screen, fireEvent } from '@testing-library/react'
import { TaskArtifactAgent } from '@prisma/client'
import { SpecArtifactGroup } from '@/app/workspace/[workspaceUrl]/components/SpecArtifactGroup'
import { useArtifacts } from '@/app/workspace/[workspaceUrl]/hooks/useArtifacts'

const mockUseArtifacts = useArtifacts as jest.Mock

function setup() {
  const remove = jest.fn()
  const artifact = {
    id: 'art-1',
    kind: 'spec',
    title: 'My spec',
    content: 'body',
    source: 'manual',
    agent: TaskArtifactAgent.CLAUDE_CODE,
    createdAt: new Date('2026-06-15T12:00:00Z'),
    loading: false,
  }
  mockUseArtifacts.mockReturnValue({
    artifacts: [artifact],
    add: jest.fn(),
    update: jest.fn(),
    remove,
  })
  render(<SpecArtifactGroup taskId='t1' />)
  return { remove }
}

describe('SpecArtifactGroup delete confirmation', () => {
  afterEach(() => jest.clearAllMocks())

  it('clicking the trash button opens a confirmation dialog and does NOT delete yet', () => {
    const { remove } = setup()

    // No dialog before the click.
    expect(screen.queryByText('Delete artifact?')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Delete'))

    // Confirmation surfaces; nothing deleted yet.
    expect(screen.getByText('Delete artifact?')).toBeInTheDocument()
    expect(remove).not.toHaveBeenCalled()
  })

  it('deletes only after confirming in the dialog', () => {
    const { remove } = setup()

    fireEvent.click(screen.getByLabelText('Delete'))
    // The destructive action carries the text "Delete" (the trash button only has it as aria-label).
    fireEvent.click(screen.getByText('Delete'))

    expect(remove).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledWith('art-1')
  })

  it('cancelling the dialog deletes nothing', () => {
    const { remove } = setup()

    fireEvent.click(screen.getByLabelText('Delete'))
    fireEvent.click(screen.getByText('Cancel'))

    expect(remove).not.toHaveBeenCalled()
    expect(screen.queryByText('Delete artifact?')).not.toBeInTheDocument()
  })
})
