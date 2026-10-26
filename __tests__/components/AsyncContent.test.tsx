/** @jest-environment jsdom */

jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (d: { id: string }) => d.id,
  }),
}))

import { fireEvent, render, screen } from '@testing-library/react'
import {
  AsyncContent,
  LoadingState,
} from '@/app/workspace/[workspaceUrl]/components/AsyncContent'
import { RowListSkeleton } from '@/app/workspace/[workspaceUrl]/components/skeletons/RowListSkeleton'
import {
  TaskBoardSkeleton,
  TaskTableSkeleton,
} from '@/app/workspace/[workspaceUrl]/components/skeletons/TaskSkeletons'
import {
  DocumentEditorSkeleton,
  DocumentGridSkeleton,
  DocumentListSkeleton,
} from '@/app/workspace/[workspaceUrl]/components/skeletons/DocumentSkeletons'
import { rowDelay } from '@/app/workspace/[workspaceUrl]/components/skeletons/SkeletonLine'

describe('AsyncContent', () => {
  it('renders a status region with the default row skeleton and no visible loading text', () => {
    render(
      <AsyncContent loading>
        <p>content</p>
      </AsyncContent>
    )
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('common.loading')).toHaveClass('sr-only')
    expect(screen.getByTestId('row-list-skeleton')).toBeInTheDocument()
    expect(screen.queryByText('content')).not.toBeInTheDocument()
  })

  it('renders the loadingState slot instead of the default skeleton', () => {
    render(
      <AsyncContent loading loadingState={<TaskTableSkeleton />}>
        <p>content</p>
      </AsyncContent>
    )
    expect(screen.getByTestId('task-table-skeleton')).toBeInTheDocument()
    expect(screen.queryByTestId('row-list-skeleton')).not.toBeInTheDocument()
  })

  it('passes className to the loading region so it fills the same box', () => {
    render(
      <AsyncContent loading className='flex-1 flex flex-col'>
        <p>content</p>
      </AsyncContent>
    )
    expect(screen.getByRole('status')).toHaveClass('flex-1', 'flex-col')
  })

  it('shows the error with a retry link only when onRetry is given', () => {
    const onRetry = jest.fn()
    const { rerender } = render(
      <AsyncContent loading={false} error='boom' onRetry={onRetry}>
        <p>content</p>
      </AsyncContent>
    )
    fireEvent.click(screen.getByText('common.retry'))
    expect(onRetry).toHaveBeenCalledTimes(1)

    rerender(
      <AsyncContent loading={false} error='boom'>
        <p>content</p>
      </AsyncContent>
    )
    expect(screen.getByText('boom')).toBeInTheDocument()
    expect(screen.queryByText('common.retry')).not.toBeInTheDocument()
  })

  it('shows the empty state, then the children', () => {
    const { rerender } = render(
      <AsyncContent loading={false} empty emptyState={<p>nothing</p>}>
        <p>content</p>
      </AsyncContent>
    )
    expect(screen.getByText('nothing')).toBeInTheDocument()

    rerender(
      <AsyncContent loading={false}>
        <p>content</p>
      </AsyncContent>
    )
    expect(screen.getByText('content')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('LoadingState', () => {
  it('uses a custom sr-only label when given', () => {
    render(<LoadingState label='Loading teams…' />)
    expect(screen.getByText('Loading teams…')).toHaveClass('sr-only')
    expect(screen.getByTestId('row-list-skeleton')).toBeInTheDocument()
  })
})

describe('skeletons', () => {
  it('RowListSkeleton renders the requested rows, hidden from assistive tech', () => {
    render(<RowListSkeleton rows={5} leading='avatar' subtitle />)
    const list = screen.getByTestId('row-list-skeleton')
    expect(list).toHaveAttribute('aria-hidden')
    expect(list.children).toHaveLength(5)
  })

  it('TaskTableSkeleton rows match the data table row height', () => {
    render(<TaskTableSkeleton rows={3} />)
    const table = screen.getByTestId('task-table-skeleton')
    // header strip + 3 rows
    expect(table.children).toHaveLength(4)
    expect(table.children[1]).toHaveStyle({ height: '49px' })
  })

  it.each([
    ['task-board-skeleton', <TaskBoardSkeleton key='b' />],
    ['document-list-skeleton', <DocumentListSkeleton key='l' />],
    ['document-grid-skeleton', <DocumentGridSkeleton key='g' />],
    ['document-editor-skeleton', <DocumentEditorSkeleton key='e' />],
  ])('%s renders hidden from assistive tech', (testId, node) => {
    render(node)
    expect(screen.getByTestId(testId)).toHaveAttribute('aria-hidden')
  })

  it('rowDelay staggers four rows then wraps', () => {
    expect([0, 1, 2, 3, 4].map(rowDelay)).toEqual([0, 120, 240, 360, 0])
  })
})
