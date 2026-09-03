import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const messages: Record<string, string> = {
  'securityScan.section.title': 'Security scan',
  'securityScan.banner.blocking': 'blocking {count}',
  'securityScan.judgeUnavailable': 'LLM review did not complete',
  'securityScan.severity.HIGH': 'High',
  'securityScan.severity.LOW': 'Low',
  'securityScan.provenance.DETERMINISTIC': 'Pattern match',
  'securityScan.provenance.LLM_JUDGE': 'LLM review',
  'securityScan.disposition.FALSE_POSITIVE': 'False positive',
  'securityScan.disposition.inherited': 'carried over',
  'securityScan.action.falsePositive': 'Mark false positive',
  'securityScan.action.acceptRisk': 'Accept risk',
  'securityScan.action.notePlaceholder': 'Why?',
  'securityScan.action.confirm': 'Confirm',
  'securityScan.action.cancel': 'Cancel',
  'securityScan.meta': 'Scanned {sha}',
}
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }, values?: Record<string, unknown>) =>
      (messages[id] ?? id).replace(/\{(\w+)\}/g, (_m, k: string) =>
        String(values?.[k] ?? '')
      ),
  }),
}))
const invalidateQueries = jest.fn()
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries }),
}))
const dispositionSecurityFinding = jest.fn().mockResolvedValue({})
jest.mock('@/lib/api-client', () => ({
  tasksClient: {
    dispositionSecurityFinding: (...a: unknown[]) =>
      dispositionSecurityFinding(...a),
  },
}))
jest.mock('@/app/workspace/[workspaceUrl]/components/pr-helpers', () => ({
  SecurityScanBadge: ({ scan }: { scan: { status: string } | null }) => (
    <span data-testid='security-scan-badge'>{scan?.status ?? 'none'}</span>
  ),
}))
const useSecurityScans = jest.fn()
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useSecurityScans', () => ({
  useSecurityScans: (id: string) => useSecurityScans(id),
}))

import { SecurityScanSection } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/SecurityScanSection'

const finding = (over: object) => ({
  id: 'f1',
  kind: 'SECRET',
  ruleId: 'secret:aws-access-key-id',
  severity: 'HIGH',
  provenance: 'DETERMINISTIC',
  filePath: 'src/cfg.ts',
  line: 3,
  title: 'AWS access key ID',
  detail: 'committed',
  evidence: 'const k = "AKIA…(len 20)"',
  fingerprint: 'fp',
  disposition: null,
  dispositionNote: null,
  inherited: false,
  blocking: true,
  ...over,
})
const scan = (over: object) => ({
  id: 's1',
  status: 'FINDINGS',
  headSha: 'abcdef1234567',
  trigger: 'PR_EVENT',
  judgeStatus: 'RAN',
  truncated: false,
  error: null,
  startedAt: '2026-09-03T00:00:00Z',
  finishedAt: null,
  findings: [finding({})],
  ...over,
})
const pr = {
  id: 'pr1',
  number: 9,
  title: 'feat',
  url: 'https://github.com/o/r/pull/9',
  state: 'open',
}

beforeEach(() => {
  jest.clearAllMocks()
})

test('renders nothing while loading or without PRs', () => {
  useSecurityScans.mockReturnValue({ data: undefined, isLoading: true })
  const { container } = render(<SecurityScanSection taskId='t1' />)
  expect(container).toBeEmptyDOMElement()
  useSecurityScans.mockReturnValue({
    data: { prs: [], blocking: { count: 0 } },
    isLoading: false,
  })
  render(<SecurityScanSection taskId='t1' />)
  expect(screen.queryByTestId('security-scan-panel')).toBeNull()
})

test('shows the blocking banner, judge-unavailable notice and finding rows', () => {
  useSecurityScans.mockReturnValue({
    data: {
      prs: [{ pr, latest: scan({ judgeStatus: 'UNAVAILABLE' }) }],
      blocking: { count: 1 },
    },
    isLoading: false,
  })
  render(<SecurityScanSection taskId='t1' />)
  expect(screen.getByTestId('security-blocking-banner')).toHaveTextContent(
    'blocking 1'
  )
  expect(screen.getByTestId('judge-unavailable')).toBeInTheDocument()
  expect(screen.getByTestId('security-finding-f1')).toHaveAttribute(
    'data-blocking',
    'true'
  )
  expect(screen.getByText('src/cfg.ts:3')).toBeInTheDocument()
  expect(screen.getByText('Scanned abcdef1')).toBeInTheDocument()
})

test('a human can mark a finding false positive with a note', async () => {
  useSecurityScans.mockReturnValue({
    data: { prs: [{ pr, latest: scan({}) }], blocking: { count: 1 } },
    isLoading: false,
  })
  render(<SecurityScanSection taskId='t1' />)
  fireEvent.click(screen.getByText('Mark false positive'))
  fireEvent.change(screen.getByPlaceholderText('Why?'), {
    target: { value: 'doc key' },
  })
  fireEvent.click(screen.getByText('Confirm'))
  await waitFor(() =>
    expect(dispositionSecurityFinding).toHaveBeenCalledWith('t1', 'f1', {
      disposition: 'FALSE_POSITIVE',
      note: 'doc key',
    })
  )
  expect(invalidateQueries).toHaveBeenCalled()
})

test('a dispositioned finding shows its disposition and no action buttons', () => {
  useSecurityScans.mockReturnValue({
    data: {
      prs: [
        {
          pr,
          latest: scan({
            findings: [
              finding({
                disposition: 'FALSE_POSITIVE',
                inherited: true,
                blocking: false,
              }),
            ],
          }),
        },
      ],
      blocking: { count: 0 },
    },
    isLoading: false,
  })
  render(<SecurityScanSection taskId='t1' />)
  expect(screen.getByTestId('finding-disposition')).toHaveTextContent(
    'False positive · carried over'
  )
  expect(screen.queryByText('Mark false positive')).toBeNull()
  expect(screen.queryByTestId('security-blocking-banner')).toBeNull()
})
