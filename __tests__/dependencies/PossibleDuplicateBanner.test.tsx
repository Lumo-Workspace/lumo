// LUM-1286: possible duplicates surface as a banner under the task title.
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (
      { id }: { id: string },
      values?: Record<string, unknown>
    ) => (values ? `${id} ${JSON.stringify(values)}` : id),
  }),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useDependencies', () => ({
  useDependencies: jest.fn(),
}))

import { render, screen, fireEvent } from '@testing-library/react'
import { PossibleDuplicateBanner } from '@/app/workspace/[workspaceUrl]/dependencies/components/PossibleDuplicateBanner'
import { selectSuggestedDuplicates } from '@/app/workspace/[workspaceUrl]/dependencies/groupDependencies'
import { useDependencies } from '@/app/workspace/[workspaceUrl]/hooks/useDependencies'
import type { DependencyEdge } from '@/app/workspace/[workspaceUrl]/dependencies/types'

const edge = (o: Partial<DependencyEdge>): DependencyEdge => ({
  id: 'd1',
  direction: 'BLOCKED_BY',
  kind: 'DUPLICATES',
  source: 'DETECTED',
  status: 'SUGGESTED',
  reason: 'possible_duplicate',
  detail: { score: 0.95 },
  other: { identifier: 'LUM-2', title: '导出冲刺燃尽图为 CSV', status: 'TODO' },
  ...o,
})

const patch = { mutate: jest.fn(), isPending: false }
function renderBanner(edges: DependencyEdge[]) {
  ;(useDependencies as jest.Mock).mockReturnValue({
    edges,
    loading: false,
    error: null,
    patch,
  })
  return render(
    <PossibleDuplicateBanner taskIdentifier='LUM-50' workspaceUrl='lumo' />
  )
}

beforeEach(() => jest.clearAllMocks())

describe('selectSuggestedDuplicates', () => {
  it('keeps only suggested duplicates where this task is the possible duplicate', () => {
    const keep = edge({ id: 'keep' })
    const out = selectSuggestedDuplicates([
      keep,
      edge({ id: 'confirmed', status: 'CONFIRMED' }),
      edge({ id: 'dismissed', status: 'DISMISSED' }),
      edge({ id: 'blocks', kind: 'BLOCKS', reason: 'shared_files' }),
      edge({ id: 'other-side', direction: 'BLOCKS' }),
    ])
    expect(out.map(e => e.id)).toEqual(['keep'])
  })
})

describe('PossibleDuplicateBanner', () => {
  it('renders nothing when there is no suggested duplicate', () => {
    const { container } = renderBanner([
      edge({ status: 'CONFIRMED' }),
      edge({ kind: 'BLOCKS', reason: 'shared_files' }),
    ])
    expect(container).toBeEmptyDOMElement()
  })

  it('lists each likely original with its score and actions', () => {
    renderBanner([edge({})])

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('task.possibleDuplicate.title')).toBeInTheDocument()
    expect(screen.getByText('LUM-2')).toBeInTheDocument()
    expect(screen.getByText('导出冲刺燃尽图为 CSV')).toBeInTheDocument()
    expect(
      screen.getByText('task.possibleDuplicate.score {"score":95}')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'task.possibleDuplicate.open' })
    ).toHaveAttribute('href', '/workspace/lumo/my-tasks/LUM-2')
  })

  it('confirms or dismisses the suggestion', () => {
    renderBanner([edge({})])

    fireEvent.click(
      screen.getByRole('button', { name: 'task.possibleDuplicate.confirm' })
    )
    expect(patch.mutate).toHaveBeenCalledWith({ depId: 'd1', action: 'confirm' })

    fireEvent.click(
      screen.getByRole('button', { name: 'task.possibleDuplicate.dismiss' })
    )
    expect(patch.mutate).toHaveBeenCalledWith({ depId: 'd1', action: 'dismiss' })
  })
})
