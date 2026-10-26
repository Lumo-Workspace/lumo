/** @jest-environment jsdom */
/**
 * LUM-1266 follow-up — the Record tab's regions load behind Skeleton
 * placeholders shaped like the content, not a bare "Loading…" line. The label
 * stays in the DOM as sr-only text so screen readers still announce it.
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

jest.mock('react-intl', () => {
  const messages = jest.requireActual('@/lib/i18n/en.json') as Record<
    string,
    string
  >
  return {
    useIntl: () => ({
      locale: 'en',
      formatMessage: ({ id }: { id: string }) => messages[id] ?? id,
      formatNumber: (n: number) => `${n}`,
    }),
  }
})
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useTaskStatus', () => ({
  useTaskStatus: () => ({
    data: null,
    loading: true,
    error: null,
    refresh: jest.fn(),
  }),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useBoundaryCrossings', () => ({
  useBoundaryCrossings: () => ({ crossings: [], gateEnabled: true }),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useTaskLineage', () => ({
  useTaskLineage: () => ({ data: null, loading: true, error: null }),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useTestCases', () => ({
  useTestCases: () => ({
    testCases: [],
    pullRequests: [],
    loading: true,
    error: null,
    add: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    recordRun: jest.fn(),
  }),
}))

import {
  DoneGateSkeleton,
  LineageSkeleton,
  TestCaseListSkeleton,
} from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/RecordSkeletons'
import { RecordTab } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/RecordTab'
import { LineageTab } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/LineageTab'
import { TestCasesSection } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/TestCasesSection'

const skeletonBars = (el: HTMLElement) =>
  el.querySelectorAll('[data-slot="skeleton"]').length

describe('Record skeletons', () => {
  it('DoneGateSkeleton draws the header plus one row per gate', () => {
    render(<DoneGateSkeleton label='Loading…' />)
    const root = screen.getByTestId('record-skeleton')
    expect(root).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('Loading…')).toHaveClass('sr-only')
    // 2 header lines + 3 rows × (icon + label + detail)
    expect(skeletonBars(root)).toBe(11)
  })

  it('TestCaseListSkeleton draws two collapsed case headers', () => {
    render(<TestCaseListSkeleton label='Loading test cases…' />)
    const root = screen.getByTestId('test-cases-skeleton')
    expect(root).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('Loading test cases…')).toHaveClass('sr-only')
    expect(skeletonBars(root)).toBe(8)
  })

  it('LineageSkeleton draws the summary row and body lines', () => {
    render(<LineageSkeleton label='Loading…' />)
    const root = screen.getByTestId('lineage-skeleton')
    expect(root).toHaveAttribute('aria-busy', 'true')
    expect(skeletonBars(root)).toBe(4)
  })
})

describe('Record tab regions render skeletons while loading', () => {
  it('RecordTab shows the Done gate skeleton, not a text line', () => {
    render(<RecordTab taskIdentifier='LUM-1' enabled />)
    expect(screen.getByTestId('record-skeleton')).toBeInTheDocument()
    expect(screen.getByText('Loading…')).toHaveClass('sr-only')
  })

  it('LineageTab shows the lineage skeleton', () => {
    render(<LineageTab taskIdentifier='LUM-1' enabled />)
    expect(screen.getByTestId('lineage-skeleton')).toBeInTheDocument()
    expect(screen.getByText('Loading…')).toHaveClass('sr-only')
  })

  it('TestCasesSection shows the case-list skeleton', () => {
    render(
      <TestCasesSection
        owner={{ kind: 'task', id: 't-1' }}
        handlePrefix='LUM-1'
        enabled
      />
    )
    expect(screen.getByTestId('test-cases-skeleton')).toBeInTheDocument()
    expect(screen.getByText('Loading test cases…')).toHaveClass('sr-only')
  })
})
