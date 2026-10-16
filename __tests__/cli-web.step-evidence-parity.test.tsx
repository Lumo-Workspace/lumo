/** @jest-environment jsdom */
/**
 * LUM-1185 follow-up — web TestCaseRunReport and CLI `testcase show` put the
 * same evidence under the same step (and the same leftovers at the end of the
 * run), from one fixture. Both read `deriveStepReport` rows[].evidence (raw
 * indices into run.evidence).
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
import { formatRunLines } from '@/cli/src/commands/task-testcase-show'
import { deriveStepReport } from '@/lib/test-cases/step-report'

const steps = ['open invoice', 'click Refund', 'click Issue refund']
const verification = ['banner says Refunded']

const file = (filename: string, id: string, contentType = 'image/png') => ({
  type: 'file',
  url: `https://lumo.example/api/files/test-evidence/t/c/${id}`,
  filename,
  contentType,
  size: 10,
})

const stepResult = (
  phase: 'STEPS' | 'VERIFICATION',
  index: number,
  evidence: number[]
) => ({
  phase,
  index,
  text: (phase === 'STEPS' ? steps : verification)[index],
  status: 'PASS',
  reason: null,
  durationMs: null,
  evidence,
})

const run = {
  id: 'run-1',
  testCaseId: 'tc-1',
  taskId: 't-1',
  result: 'PASS',
  environment: 'LOCAL',
  failedPhase: null,
  failedIndex: null,
  failedStepText: null,
  failureAttribution: null,
  unprovenVerification: [],
  stepResults: [
    stepResult('STEPS', 0, [1]),
    stepResult('STEPS', 1, []),
    stepResult('STEPS', 2, [3, 4]),
    stepResult('VERIFICATION', 0, [0]),
  ],
  actual: null,
  evidence: [
    file('banner.png', 'f0'),
    file('invoice.png', 'f1'),
    { type: 'link', url: 'https://ci.example.com/7', label: 'CI run' },
    file('refund.log', 'f3', 'text/plain'),
    'junk',
    file('run-level.txt', 'f5', 'text/plain'),
  ],
  note: null,
  pullRequestId: null,
  commitSha: null,
  commitDirty: null,
  executedByMemberId: null,
  sourceSessionId: null,
  createdAt: new Date('2026-10-17T08:00:00Z'),
  disposition: null,
}

const LABELS = [
  'banner.png',
  'invoice.png',
  'CI run',
  'refund.log',
  'run-level.txt',
]

/** Evidence labels present inside a DOM subtree (image alt or link text). */
function webLabels(el: HTMLElement): string[] {
  const scope = within(el)
  return LABELS.filter(
    l => scope.queryByAltText(l) !== null || scope.queryByText(l) !== null
  )
}

/** CLI: labels on the indented lines following each step row / at the end. */
function cliAssignment(lines: string[]) {
  const perStep: string[][] = []
  const tail: string[] = []
  let current: string[] | null = null
  for (const line of lines) {
    if (/^ {4}[✓✗•○?\-»] (step|verification) \d+/.test(line)) {
      current = []
      perStep.push(current)
      continue
    }
    const label = LABELS.find(l => line.trim().startsWith(`${l}  `))
    if (!label) continue
    if (line.startsWith('        ') && current) current.push(label)
    else tail.push(label)
  }
  return { perStep, tail }
}

it('web and CLI assign the same evidence to each step and the same leftovers to the run', () => {
  render(
    <TestCaseRunReport
      run={run as never}
      steps={steps}
      verification={verification}
      expected='Refunded'
      requiredEnvironment={null}
      pullRequests={[]}
    />
  )
  const webPerStep = screen.getAllByTestId('step-row').map(webLabels)
  const allWeb = webLabels(screen.getByTestId('run-report'))
  const webStepSet = new Set(webPerStep.flat())
  const webTail = allWeb.filter(l => !webStepSet.has(l))

  const wire = {
    ...run,
    createdAt: run.createdAt.toISOString(),
    executedBy: null,
    stepReport: deriveStepReport({ steps, verification }, run as never),
  }
  const cli = cliAssignment(formatRunLines(wire as never, []))

  expect(cli.perStep).toEqual(webPerStep)
  expect(cli.tail.sort()).toEqual(webTail.sort())
  // Pin the expected assignment itself so both sides can't drift together.
  expect(webPerStep).toEqual([
    ['invoice.png'],
    [],
    ['refund.log'],
    ['banner.png'],
  ])
  expect(webTail.sort()).toEqual(['CI run', 'run-level.txt'])
})
