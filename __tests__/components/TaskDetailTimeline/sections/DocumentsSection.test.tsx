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
        <DocumentsSection documents={[]} workspaceUrl='lumo' />
      </Accordion>
    )
    expect(screen.getByText('task.context.documents.empty')).toBeInTheDocument()
  })

  it('renders each document with title', () => {
    render(
      <Accordion type='multiple' defaultValue={['documents']}>
        <DocumentsSection
          workspaceUrl='lumo'
          documents={[
            {
              id: 'd1',
              title: 'Spec',
              emoji: null,
              updatedAt: '2026-05-19T00:00:00Z',
            },
            {
              id: 'd2',
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

  it('renders count in header', () => {
    render(
      <Accordion type='multiple'>
        <DocumentsSection
          workspaceUrl='lumo'
          documents={[
            { id: 'd1', title: 'a', emoji: null, updatedAt: '' },
            { id: 'd2', title: 'b', emoji: null, updatedAt: '' },
            { id: 'd3', title: 'c', emoji: null, updatedAt: '' },
          ]}
        />
      </Accordion>
    )
    expect(screen.getByText('3')).toBeInTheDocument()
  })
})
