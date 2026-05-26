jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (d: { id?: string; defaultMessage?: string }) =>
      d.id ?? d.defaultMessage ?? '',
  }),
}))

import { render, screen } from '@testing-library/react'
import { Accordion } from '@/components/landing/ui/accordion'
import { DocumentsSection } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/DocumentsSection'

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
            },
            {
              id: 'd2',
              slug: 'rfc-2',
              title: 'RFC',
              emoji: '📄',
              updatedAt: '2026-05-19T00:00:00Z',
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
            { id: 'd1', slug: 'a-1', title: 'a', emoji: null, updatedAt: '' },
            { id: 'd2', slug: 'b-2', title: 'b', emoji: null, updatedAt: '' },
            { id: 'd3', slug: 'c-3', title: 'c', emoji: null, updatedAt: '' },
          ]}
        />
      </Accordion>
    )
    expect(screen.getByText('3')).toBeInTheDocument()
  })
})
