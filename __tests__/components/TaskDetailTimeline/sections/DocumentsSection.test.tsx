jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (d: { id?: string; defaultMessage?: string }) =>
      d.id ?? d.defaultMessage ?? '',
  }),
}))

jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock('@/lib/api-client/task-documents', () => ({
  taskDocumentsClient: {
    search: jest.fn(),
    attach: jest.fn(),
    detach: jest.fn(),
  },
}))

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { Accordion } from '@/components/landing/ui/accordion'
import { DocumentsSection } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/DocumentsSection'
import { taskDocumentsClient } from '@/lib/api-client/task-documents'
import { ApiClientError } from '@/lib/api-client/base'

const mockDetach = taskDocumentsClient.detach as jest.Mock
const mockToastError = toast.error as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
})

describe('DocumentsSection', () => {
  it('shows empty state when no documents', () => {
    render(
      <Accordion type='multiple' defaultValue={['documents']}>
        <DocumentsSection
          documents={[]}
          workspaceUrl='lumo'
          taskId='task-1'
          onAttached={jest.fn()}
        />
      </Accordion>
    )
    expect(screen.getByText('task.context.documents.empty')).toBeInTheDocument()
  })

  it('renders each document with title', () => {
    render(
      <Accordion type='multiple' defaultValue={['documents']}>
        <DocumentsSection
          workspaceUrl='lumo'
          taskId='task-1'
          onAttached={jest.fn()}
          documents={[
            {
              id: 'd1',
              slug: 'spec-1',
              title: 'Spec',
              emoji: null,
              updatedAt: '2026-05-19T00:00:00Z',
              source: 'CONTENT',
            },
            {
              id: 'd2',
              slug: 'rfc-2',
              title: 'RFC',
              emoji: '📄',
              updatedAt: '2026-05-19T00:00:00Z',
              source: 'EXPLICIT',
            },
          ]}
        />
      </Accordion>
    )
    expect(screen.getByText('Spec')).toBeInTheDocument()
    expect(screen.getByText('RFC')).toBeInTheDocument()
    expect(screen.getByText('📄')).toBeInTheDocument()
  })

  it('links each row to the slug URL, not the cuid', () => {
    render(
      <Accordion type='multiple' defaultValue={['documents']}>
        <DocumentsSection
          workspaceUrl='lumo'
          taskId='task-1'
          onAttached={jest.fn()}
          documents={[
            {
              id: 'd1',
              slug: 'spec-1',
              title: 'Spec',
              emoji: null,
              updatedAt: '',
              source: 'CONTENT',
            },
          ]}
        />
      </Accordion>
    )
    const link = screen.getByRole('link', { name: 'Spec' })
    expect(link).toHaveAttribute('href', '/workspace/lumo/documents/spec-1')
  })

  it('renders count in header', () => {
    render(
      <Accordion type='multiple'>
        <DocumentsSection
          workspaceUrl='lumo'
          taskId='task-1'
          onAttached={jest.fn()}
          documents={[
            { id: 'd1', slug: 'a-1', title: 'a', emoji: null, updatedAt: '', source: 'CONTENT' },
            { id: 'd2', slug: 'b-2', title: 'b', emoji: null, updatedAt: '', source: 'CONTENT' },
            { id: 'd3', slug: 'c-3', title: 'c', emoji: null, updatedAt: '', source: 'CONTENT' },
          ]}
        />
      </Accordion>
    )
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('calls detach and refreshes when the × button is clicked', async () => {
    const user = userEvent.setup()
    const onAttached = jest.fn()
    mockDetach.mockResolvedValue({ removed: 1 })

    render(
      <Accordion type='multiple' defaultValue={['documents']}>
        <DocumentsSection
          workspaceUrl='lumo'
          taskId='task-1'
          onAttached={onAttached}
          documents={[
            {
              id: 'd1',
              slug: 'spec-1',
              title: 'Spec',
              emoji: null,
              updatedAt: '',
              source: 'EXPLICIT',
            },
          ]}
        />
      </Accordion>
    )

    const detachBtn = screen.getByRole('button', {
      name: 'task.contextLink.doc.detachAction',
    })
    await user.click(detachBtn)

    expect(mockDetach).toHaveBeenCalledWith('task-1', 'd1')
    expect(onAttached).toHaveBeenCalledTimes(1)
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it('shows the content-mention-only toast on 409', async () => {
    const user = userEvent.setup()
    const onAttached = jest.fn()
    mockDetach.mockRejectedValue(
      new ApiClientError(
        'Document is only mentioned via task body',
        409,
        'CONTENT_MENTION_ONLY'
      )
    )

    render(
      <Accordion type='multiple' defaultValue={['documents']}>
        <DocumentsSection
          workspaceUrl='lumo'
          taskId='task-1'
          onAttached={onAttached}
          documents={[
            {
              id: 'd1',
              slug: 'spec-1',
              title: 'Spec',
              emoji: null,
              updatedAt: '',
              source: 'EXPLICIT',
            },
          ]}
        />
      </Accordion>
    )

    await user.click(
      screen.getByRole('button', {
        name: 'task.contextLink.doc.detachAction',
      })
    )

    expect(mockDetach).toHaveBeenCalledWith('task-1', 'd1')
    expect(mockToastError).toHaveBeenCalledWith(
      'task.contextLink.doc.errors.contentMentionOnly'
    )
    // The refresh callback is not fired when detach fails — the row is still
    // bound, so we leave it visible until the user follows the toast guidance.
    expect(onAttached).not.toHaveBeenCalled()
  })

  it('shows a generic network toast on non-409 errors', async () => {
    const user = userEvent.setup()
    mockDetach.mockRejectedValue(
      new ApiClientError('boom', 500, 'INTERNAL_ERROR')
    )

    render(
      <Accordion type='multiple' defaultValue={['documents']}>
        <DocumentsSection
          workspaceUrl='lumo'
          taskId='task-1'
          onAttached={jest.fn()}
          documents={[
            {
              id: 'd1',
              slug: 'spec-1',
              title: 'Spec',
              emoji: null,
              updatedAt: '',
              source: 'EXPLICIT',
            },
          ]}
        />
      </Accordion>
    )

    await user.click(
      screen.getByRole('button', {
        name: 'task.contextLink.doc.detachAction',
      })
    )

    expect(mockToastError).toHaveBeenCalledWith(
      'task.contextLink.common.errors.network'
    )
  })

  it('renders a source badge for each document', () => {
    render(
      <Accordion type='multiple' defaultValue={['documents']}>
        <DocumentsSection
          workspaceUrl='lumo'
          taskId='task-1'
          onAttached={jest.fn()}
          documents={[
            { id: 'd1', slug: 'a-1', title: 'a', emoji: null, updatedAt: '', source: 'CONTENT' },
            { id: 'd2', slug: 'b-2', title: 'b', emoji: null, updatedAt: '', source: 'EXPLICIT' },
          ]}
        />
      </Accordion>
    )
    expect(
      screen.getByText('task.context.documents.source.content')
    ).toBeInTheDocument()
    expect(
      screen.getByText('task.context.documents.source.explicit')
    ).toBeInTheDocument()
  })

  it('sorts CONTENT backlinks before EXPLICIT binds', () => {
    render(
      <Accordion type='multiple' defaultValue={['documents']}>
        <DocumentsSection
          workspaceUrl='lumo'
          taskId='task-1'
          onAttached={jest.fn()}
          documents={[
            { id: 'x', slug: 'x-1', title: 'Explicit doc', emoji: null, updatedAt: '', source: 'EXPLICIT' },
            { id: 'y', slug: 'y-1', title: 'Content doc', emoji: null, updatedAt: '', source: 'CONTENT' },
          ]}
        />
      </Accordion>
    )
    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Content doc')
    expect(items[1]).toHaveTextContent('Explicit doc')
  })

  it('shows a detach button only for EXPLICIT documents', () => {
    render(
      <Accordion type='multiple' defaultValue={['documents']}>
        <DocumentsSection
          workspaceUrl='lumo'
          taskId='task-1'
          onAttached={jest.fn()}
          documents={[
            { id: 'd1', slug: 'a-1', title: 'Content doc', emoji: null, updatedAt: '', source: 'CONTENT' },
            { id: 'd2', slug: 'b-2', title: 'Explicit doc', emoji: null, updatedAt: '', source: 'EXPLICIT' },
          ]}
        />
      </Accordion>
    )
    expect(
      screen.getAllByRole('button', { name: 'task.contextLink.doc.detachAction' })
    ).toHaveLength(1)
  })
})
