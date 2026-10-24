/**
 * LUM-1308 — the Lumo review card header: the verdict as one badge (with the
 * PR count when there are several) and "Copy for agent".
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (
      { id }: { id: string },
      values?: Record<string, unknown>
    ) => (values ? `${id}:${JSON.stringify(values)}` : id),
  }),
}))

import {
  CopyReviewForAgent,
  LumoReviewSummary,
} from '@/ee/security/components/TaskDetailTimeline/LumoReviewHeader'
import type { TaskSecurityScans } from '@/ee/security/services/pr-security-scan.service'

const finding = {
  id: 'f1',
  kind: 'SECRET',
  ruleId: 'secret:aws',
  severity: 'HIGH',
  provenance: 'DETERMINISTIC',
  filePath: 'src/cfg.ts',
  line: 3,
  title: 'AWS key',
  detail: 'committed',
  evidence: '',
  fingerprint: 'fp',
  externalRef: null,
  disposition: null,
  dispositionNote: null,
  inherited: false,
  blocking: true,
  persisting: false,
  queueExit: null,
}
const scan = (findings: unknown[]) => ({
  status: findings.length ? 'FINDINGS' : 'CLEAN',
  coverage: 'CHECKED',
  complete: true,
  externalLate: false,
  findings,
})
const pr = (number: number) => ({
  id: `pr${number}`,
  number,
  title: 't',
  url: `https://github.com/o/r/pull/${number}`,
  state: 'open',
})
const data = (prs: object[]): TaskSecurityScans =>
  ({
    prs,
    blocking: { count: 0 },
    suggested: { count: 0 },
    scanningOff: false,
  }) as unknown as TaskSecurityScans

// Tests replace navigator.clipboard; put the original back after each.
const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  'clipboard'
)
afterEach(() => {
  if (originalClipboard)
    Object.defineProperty(navigator, 'clipboard', originalClipboard)
  else delete (navigator as { clipboard?: unknown }).clipboard
})

test('one PR: the verdict badge alone', () => {
  render(
    <LumoReviewSummary data={data([{ pr: pr(1), latest: scan([finding]) }])} />
  )
  const badge = screen.getByTestId('lumo-review-verdict')
  expect(badge).toHaveAttribute('data-verdict', 'blocking')
  expect(badge).toHaveTextContent('lumoReview.verdict.blocking:{"count":1}')
  expect(screen.queryByText(/lumoReview.pr.count/)).toBeNull()
})

test('several PRs: the badge and how many PRs', () => {
  render(
    <LumoReviewSummary
      data={data([
        { pr: pr(1), latest: scan([]) },
        { pr: pr(2), latest: scan([]) },
      ])}
    />
  )
  expect(screen.getByTestId('lumo-review-verdict')).toHaveAttribute(
    'data-verdict',
    'clean'
  )
  expect(
    screen.getByText('lumoReview.pr.count:{"count":2}')
  ).toBeInTheDocument()
})

test('Copy for agent copies every open finding', async () => {
  const writeText = jest.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  })
  render(
    <CopyReviewForAgent data={data([{ pr: pr(7), latest: scan([finding]) }])} />
  )
  fireEvent.click(screen.getByTestId('lumo-review-copy'))
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
  expect(writeText.mock.calls[0][0]).toContain('AWS key')
  expect(
    await screen.findByText('securityScan.action.copied')
  ).toBeInTheDocument()
})

test('Copy for agent is not drawn when nothing needs a decision', () => {
  const { container } = render(
    <CopyReviewForAgent data={data([{ pr: pr(7), latest: scan([]) }])} />
  )
  expect(container).toBeEmptyDOMElement()
})

test('Copy for agent says so when the clipboard write fails', async () => {
  const writeText = jest.fn().mockRejectedValue(new Error('denied'))
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  })
  render(
    <CopyReviewForAgent data={data([{ pr: pr(7), latest: scan([finding]) }])} />
  )
  fireEvent.click(screen.getByTestId('lumo-review-copy'))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'lumoReview.copyFailed'
  )
  expect(screen.queryByText('securityScan.action.copied')).toBeNull()
})

test('the copy-failed line clears on its own', async () => {
  jest.useFakeTimers()
  try {
    const writeText = jest.fn().mockRejectedValue(new Error('denied'))
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    render(
      <CopyReviewForAgent
        data={data([{ pr: pr(7), latest: scan([finding]) }])}
      />
    )
    fireEvent.click(screen.getByTestId('lumo-review-copy'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByRole('alert')).toBeInTheDocument()
    act(() => {
      jest.advanceTimersByTime(4000)
    })
    expect(screen.queryByRole('alert')).toBeNull()
  } finally {
    jest.useRealTimers()
  }
})
