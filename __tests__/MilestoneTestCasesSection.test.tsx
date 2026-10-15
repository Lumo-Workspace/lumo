/** @jest-environment jsdom */
/** LUM-1135: the milestone test-cases section wires owner, handle prefix and gate banner. */
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
      formatMessage: (
        { id }: { id: string },
        values?: Record<string, string | number>
      ) =>
        Object.entries(values ?? {}).reduce(
          (acc, [k, v]) => acc.split(`{${k}`).join(String(v)),
          messages[id] ?? id
        ),
    }),
  }
})
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}))
jest.mock('@/lib/api-client', () => ({
  milestonesClient: { overrideClose: jest.fn() },
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useTestCases', () => ({
  useTestCases: jest.fn(),
}))

import { MilestoneTestCasesSection } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneTestCasesSection'
import { useTestCases } from '@/app/workspace/[workspaceUrl]/hooks/useTestCases'

const mkCase = (n: number, title: string) => ({
  id: `c${n}`,
  number: n,
  title,
  steps: [],
  expected: 'ok',
  runs: [],
})

it('renders milestone-prefixed handles and the gate banner for a milestone owner', () => {
  ;(useTestCases as jest.Mock).mockReturnValue({
    testCases: [mkCase(1, 'Round trip'), mkCase(2, 'Approve')],
    pullRequests: [],
    gate: {
      held: 2,
      cases: [
        {
          number: 1,
          title: 'Round trip',
          state: 'held',
          reason: 'NOT_RUN',
          unprovenPass: false,
        },
        {
          number: 2,
          title: 'Approve',
          state: 'held',
          reason: 'NOT_RUN',
          unprovenPass: false,
        },
      ],
    },
    loading: false,
    error: null,
    add: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    recordRun: jest.fn(),
    disposeDefect: jest.fn(),
  })
  render(
    <MilestoneTestCasesSection
      milestoneId='m-1'
      milestoneName='Beta'
      allTasksDone={false}
      completed={false}
      members={[]}
    />
  )
  expect(screen.getByTitle('Beta/TC1')).toBeInTheDocument()
  expect(screen.getByRole('status')).toBeInTheDocument()
  expect(useTestCases).toHaveBeenCalledWith({ kind: 'milestone', id: 'm-1' })
})

it('offers the ruling for an undispositioned proven defect on the milestone', () => {
  ;(useTestCases as jest.Mock).mockReturnValue({
    testCases: [
      {
        ...mkCase(1, 'Round trip'),
        verification: [],
        requiredEnvironment: null,
        runs: [
          {
            id: 'r-1',
            result: 'FAIL',
            environment: 'PRODUCTION',
            failureAttribution: 'IMPLEMENTATION_DEFECT',
            unprovenVerification: [],
            evidence: [{ type: 'link', url: 'https://x' }],
            disposition: null,
            createdAt: '2026-10-14T00:00:00.000Z',
          },
        ],
      },
    ],
    pullRequests: [],
    gate: null,
    loading: false,
    error: null,
    add: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    recordRun: jest.fn(),
    disposeDefect: jest.fn(),
  })
  render(
    <MilestoneTestCasesSection
      milestoneId='m-1'
      milestoneName='Beta'
      allTasksDone
      completed={false}
      members={[]}
    />
  )
  expect(screen.getByTestId('blocking-test-defects')).toBeInTheDocument()
  expect(screen.getByTestId('dispose-consequence')).toBeInTheDocument()
})
