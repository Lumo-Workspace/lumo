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

  it('draws a skipped step with its reason', () => {
    renderReport(
      run({
        result: 'PASS',
        failureAttribution: null,
        stepResults: [
          {
            phase: 'STEPS',
            index: 0,
            text: steps[0],
            status: 'PASS',
            durationMs: null,
            evidence: [],
          },
          {
            phase: 'STEPS',
            index: 1,
            text: steps[1],
            status: 'SKIP',
            reason: 'no staging DB',
            durationMs: null,
            evidence: [],
          },
          {
            phase: 'STEPS',
            index: 2,
            text: steps[2],
            status: 'PASS',
            durationMs: null,
            evidence: [],
          },
          {
            phase: 'VERIFICATION',
            index: 0,
            text: verification[0],
            status: 'PASS',
            durationMs: null,
            evidence: [],
          },
        ],
      })
    )
    expect(rowStates()).toEqual(['passed', 'skipped', 'passed', 'passed'])
    expect(screen.getByLabelText('Skipped')).toBeInTheDocument()
    expect(screen.getByText(/no staging DB/)).toBeInTheDocument()
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

  // 用户 2026-10-06：「1 Step / 2 Step / 1 Check」读起来像乱序。分成两组、
  // 组标题各一次，组内各自从 1 编号（与 CLI 的 s<n> / v<n> 对齐）。
  it('groups steps and verification under one title each, numbered within the group', () => {
    renderReport(run({ failedPhase: 'VERIFICATION', failedIndex: 0 }))
    const groups = screen.getAllByTestId('step-group')
    expect(groups).toHaveLength(2)
    expect(within(groups[0]!).getByRole('list')).toHaveAccessibleName('Steps')
    expect(within(groups[1]!).getByRole('list')).toHaveAccessibleName(
      'Verification'
    )
    const numbers = (g: HTMLElement) =>
      within(g)
        .getAllByTestId('step-row')
        .map(r => r.querySelector('.tabular-nums')?.textContent)
    expect(numbers(groups[0]!)).toEqual(['1', '2', '3'])
    expect(numbers(groups[1]!)).toEqual(['1'])
    // No per-row phase label any more.
    expect(screen.queryByText('Step')).toBeNull()
    expect(screen.queryByText('Check')).toBeNull()
  })

  it('draws no group title when the case has no verification', () => {
    render(
      <TestCaseRunReport
        run={run({ result: 'PASS', failureAttribution: null }) as never}
        steps={steps}
        verification={[]}
        expected='Refunded to Visa 4242'
        requiredEnvironment={null}
        pullRequests={[]}
      />
    )
    expect(screen.getAllByTestId('step-group')).toHaveLength(1)
    expect(screen.queryByText('Steps')).toBeNull()
    expect(screen.getByRole('list')).toHaveAccessibleName('Steps')
  })
})
