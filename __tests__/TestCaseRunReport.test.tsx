/** @jest-environment jsdom */
/**
 * LUM-1011: one run as a step-by-step report — where it broke, each step's
 * state, expected vs actual under the failing step, evidence on its step.
 * A run that reported only its failure point draws no ✓ anywhere.
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'

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
          (acc, [k, v]) => acc.split(`{${k}}`).join(String(v)),
          messages[id] ?? id
        ),
    }),
  }
})

import { TestCaseRunReport } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/TestCaseRunReport'

const steps = ['open invoice', 'click Refund', 'click Issue refund']
const verification = ['banner says Refunded to Visa 4242']

const run = (over: Record<string, unknown> = {}) =>
  ({
    id: 'run-1',
    testCaseId: 'tc-1',
    taskId: 't-1',
    result: 'FAIL',
    environment: 'PRODUCTION',
    failedPhase: null,
    failedIndex: null,
    failedStepText: null,
    failureAttribution: 'IMPLEMENTATION_DEFECT',
    unprovenVerification: [],
    stepResults: [],
    actual: null,
    evidence: [],
    note: null,
    pullRequestId: null,
    commitSha: null,
    commitDirty: null,
    executedByMemberId: null,
    sourceSessionId: null,
    createdAt: new Date('2026-10-06'),
    disposition: null,
    ...over,
  }) as never

const renderReport = (r: unknown) =>
  render(
    <TestCaseRunReport
      run={r as never}
      steps={steps}
      verification={verification}
      expected='Refunded to Visa 4242'
      requiredEnvironment={null}
      pullRequests={[]}
    />
  )

const rowStates = () =>
  screen.getAllByTestId('step-row').map(r => r.getAttribute('data-state'))

describe('TestCaseRunReport', () => {
  it('draws each reported step, the break point, expected vs actual and step evidence', () => {
    renderReport(
      run({
        failedPhase: 'VERIFICATION',
        failedIndex: 0,
        failedStepText: verification[0],
        actual: 'Issued as store credit',
        evidence: [
          {
            type: 'file',
            url: 'https://blob.example/s4.png',
            filename: 's4.png',
            contentType: 'image/png',
            size: 10,
          },
        ],
        stepResults: [
          {
            phase: 'STEPS',
            index: 0,
            text: steps[0],
            status: 'PASS',
            durationMs: 1200,
            evidence: [],
          },
          {
            phase: 'STEPS',
            index: 1,
            text: steps[1],
            status: 'PASS',
            durationMs: 400,
            evidence: [],
          },
          {
            phase: 'STEPS',
            index: 2,
            text: steps[2],
            status: 'PASS',
            durationMs: 900,
            evidence: [],
          },
          {
            phase: 'VERIFICATION',
            index: 0,
            text: verification[0],
            status: 'FAIL',
            durationMs: 300,
            evidence: [0],
          },
        ],
      })
    )

    expect(screen.getByTestId('run-report-header')).toHaveTextContent(
      'Failed at verification 1'
    )
    expect(rowStates()).toEqual(['passed', 'passed', 'passed', 'failed'])
    expect(screen.getByText('1.2s')).toBeInTheDocument()

    const failing = screen.getAllByTestId('step-row')[3]!
    const ea = within(failing).getByTestId('step-expected-actual')
    expect(ea).toHaveTextContent('Refunded to Visa 4242')
    expect(ea).toHaveTextContent('Issued as store credit')
    // The screenshot hangs under the step it belongs to, not in a loose strip.
    expect(within(failing).getByRole('img')).toHaveAttribute(
      'src',
      'https://blob.example/s4.png'
    )
  })

  it('with only a failure point, nothing is drawn as passed', () => {
    renderReport(run({ failedPhase: 'STEPS', failedIndex: 1 }))
    expect(rowStates()).toEqual([
      'reached',
      'failed',
      'notReached',
      'notReached',
    ])
    expect(screen.queryByLabelText('Passed')).toBeNull()
    expect(
      screen.getByText('No per-step results were recorded for this run.')
    ).toBeInTheDocument()
    // No actual recorded is said out loud, not left blank.
    expect(screen.getByTestId('step-expected-actual')).toHaveTextContent(
      'Not recorded'
    )
  })
})
