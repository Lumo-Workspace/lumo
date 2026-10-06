/** @jest-environment jsdom */
/**
 * LUM-1011: Needs action lists each case whose latest run is an
 * undispositioned implementation defect (the LUM-812 DONE gate) and rules on
 * it in place. A ruled-on or superseded defect is not listed.
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

jest.mock('react-intl', () => {
  const messages = jest.requireActual('@/lib/i18n/en.json') as Record<
    string,
    string
  >
  return {
    useIntl: () => ({
      locale: 'en',
      formatMessage: ({ id }: { id: string }) => messages[id] ?? id,
    }),
  }
})
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useTestCases', () => ({
  useTestCases: jest.fn(),
}))

import { BlockingTestDefects } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/BlockingTestDefects'
import { useTestCases } from '@/app/workspace/[workspaceUrl]/hooks/useTestCases'

const disposeDefect = jest.fn().mockResolvedValue(undefined)

const run = (over: Record<string, unknown> = {}) => ({
  id: 'r',
  result: 'FAIL',
  environment: 'PRODUCTION',
  failureAttribution: 'IMPLEMENTATION_DEFECT',
  unprovenVerification: [],
  evidence: [{ type: 'link', url: 'https://x' }],
  disposition: null,
  ...over,
})

const useCases = (testCases: unknown[]) =>
  (useTestCases as jest.Mock).mockReturnValue({ testCases, disposeDefect })

const renderIt = () =>
  render(<BlockingTestDefects taskId='t1' taskIdentifier='LUM-9' enabled />)

beforeEach(() => jest.clearAllMocks())

describe('BlockingTestDefects', () => {
  it('lists the defect with a link to its run and rules on it in place', () => {
    useCases([
      {
        id: 'c2',
        number: 2,
        title: 'Refund to card',
        requiredEnvironment: null,
        runs: [run({ id: 'r-2' })],
      },
      {
        id: 'c1',
        number: 1,
        title: 'Fine',
        requiredEnvironment: null,
        runs: [run({ id: 'r-1', result: 'PASS', failureAttribution: null })],
      },
    ])
    renderIt()
    expect(screen.getByText('LUM-9/TC2')).toHaveAttribute('href', '#run-r-2')
    expect(screen.queryByText('LUM-9/TC1')).toBeNull()
    fireEvent.click(screen.getByText('Accept and ship'))
    expect(disposeDefect).toHaveBeenCalledWith('r-2', 'KNOWN_DEFECT')
  })

  it('renders nothing once the defect is ruled on', () => {
    useCases([
      {
        id: 'c2',
        number: 2,
        title: 'x',
        requiredEnvironment: null,
        runs: [run({ disposition: { disposition: 'NOT_A_DEFECT' } })],
      },
    ])
    const { container } = renderIt()
    expect(container).toBeEmptyDOMElement()
  })
})
