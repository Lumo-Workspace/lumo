import { render, screen, fireEvent, waitFor } from '@testing-library/react'

jest.mock('next/navigation', () => ({
  usePathname: () => '/workspace/acme/tasks/LUM-1',
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

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
  'securityScan.section.loadError': 'Could not load security scans.',
  'securityScan.provenance.EXTERNAL_TOOL': 'External tool',
  'securityScan.stage.secrets': 'Secret patterns',
  'securityScan.stage.external': 'External scanner',
  'securityScan.stage.judge': 'LLM review',
  'securityScan.stageState.FAILED': 'failed',
  'securityScan.stageState.NOT_CONFIGURED': 'not configured',
  'securityScan.stageState.PARTIAL': 'partial',
  'securityScan.stageState.PENDING': 'scanning',
  'securityScan.external.notConfigured':
    "Lumo's managed scanner is off for this deployment and this repository has never pushed a scanner report, so only Lumo's own checks ran. A clean result here is not a full pass.",
  'securityScan.external.notConfigured.link':
    "Create a CI ingest key (for pushing your own scanner's SARIF)",
  'securityScan.external.late':
    "The scanner has not reported for this commit in 30 minutes, so this scan is incomplete. Push a new commit to start a fresh scan, or check your own CI's scan job if this repository pushes its own reports.",
  'securityScan.finding.externalLink': 'View rule documentation',
  'securityScan.partial':
    'Some results were cut off at the scan budget — the scan is not complete.',
  'securityScan.external.failedReason': 'External scanner failed:',
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
  SecurityScanBadge: ({
    scan,
  }: {
    scan: {
      status: string
      findings?: unknown[]
      complete?: boolean
    } | null
  }) => {
    const state =
      scan && scan.findings?.length === 0 && scan.complete === false
        ? 'incomplete'
        : (scan?.status ?? 'none')
    return (
      <span data-testid='security-scan-badge' data-state={state}>
        {scan?.status ?? 'none'}
      </span>
    )
  },
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
  externalRef: null,
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
  stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN' },
  partial: false,
  complete: true,
  externalLate: false,
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
const wrapper = ({ children }: { children: React.ReactNode }) => <>{children}</>

beforeEach(() => {
  jest.clearAllMocks()
})

test('renders nothing while loading or without PRs', () => {
  useSecurityScans.mockReturnValue({
    data: undefined,
    isLoading: true,
    isError: false,
  })
  const { container } = render(<SecurityScanSection taskId='t1' />)
  expect(container).toBeEmptyDOMElement()
  useSecurityScans.mockReturnValue({
    data: { prs: [], blocking: { count: 0 } },
    isLoading: false,
    isError: false,
  })
  render(<SecurityScanSection taskId='t1' />)
  expect(screen.queryByTestId('security-scan-panel')).toBeNull()
})

test('says so when the scans could not be loaded, instead of rendering nothing', () => {
  // LUM-732 review I4: a dropped fetch rendered as an absent panel, which on a
  // task with a blocking finding reads as "nothing to see here".
  useSecurityScans.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: true,
  })
  render(<SecurityScanSection taskId='t1' />)
  expect(screen.getByTestId('security-scan-load-error')).toHaveTextContent(
    'Could not load security scans.'
  )
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

test('shows an error and keeps the form when the disposition call fails', async () => {
  dispositionSecurityFinding.mockRejectedValueOnce(new Error('forbidden'))
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
    expect(screen.getByTestId('finding-disposition-error')).toHaveTextContent(
      'securityScan.action.error'
    )
  )
  expect(invalidateQueries).not.toHaveBeenCalled()
  expect(screen.getByPlaceholderText('Why?')).toHaveValue('doc key')
  expect(screen.getByText('Confirm')).not.toBeDisabled()
})

test('an incomplete scan lists the failed / unconfigured layers and the onboarding hint', () => {
  useSecurityScans.mockReturnValue({
    data: {
      prs: [
        {
          pr,
          latest: scan({
            status: 'CLEAN',
            findings: [],
            stages: {
              secrets: 'RAN',
              external: 'NOT_CONFIGURED',
              judge: 'FAILED',
            },
            complete: false,
          }),
        },
      ],
      blocking: { count: 0 },
    },
    isLoading: false,
    isError: false,
  })
  render(<SecurityScanSection taskId='t1' />, { wrapper })
  const stages = screen.getByTestId('scan-stages')
  expect(stages).toHaveTextContent('External scanner: not configured')
  expect(stages).toHaveTextContent('LLM review: failed')
  expect(stages).not.toHaveTextContent('Secret patterns')
  const hint = screen.getByTestId('external-not-configured')
  expect(hint).toHaveTextContent('only Lumo')
  const links = hint.querySelectorAll('a')
  expect(links).toHaveLength(1)
  expect(links[0]).toHaveAttribute('href', '/workspace/acme/settings/api-keys')
  expect(screen.getByTestId('security-scan-badge')).toHaveAttribute(
    'data-state',
    'incomplete'
  )
})

test('external stage FAILED renders the prefixed failure reason even when the scan itself is not FAILED', () => {
  // LUM-735 Task 1 — P9: a failed external stage keeps the scan's own status
  // (here CLEAN); the panel must still surface the reason.
  useSecurityScans.mockReturnValue({
    data: {
      prs: [
        {
          pr,
          latest: scan({
            status: 'CLEAN',
            findings: [],
            stages: { secrets: 'RAN', external: 'FAILED', judge: 'RAN' },
            complete: false,
            error: 'external: semgrep exit 90',
          }),
        },
      ],
      blocking: { count: 0 },
    },
    isLoading: false,
    isError: false,
  })
  render(<SecurityScanSection taskId='t1' />, { wrapper })
  const reason = screen.getByTestId('external-failed-reason')
  expect(reason).toHaveTextContent(
    'External scanner failed: external: semgrep exit 90'
  )
  // Not the FAILED-scan branch too — the reason renders exactly once.
  expect(screen.getAllByText(/external: semgrep exit 90/)).toHaveLength(1)
})

test('a FAILED scan whose external stage also FAILED renders the reason once, prefixed', () => {
  useSecurityScans.mockReturnValue({
    data: {
      prs: [
        {
          pr,
          latest: scan({
            status: 'FAILED',
            findings: [],
            stages: { secrets: 'RAN', external: 'FAILED', judge: 'RAN' },
            complete: false,
            error: 'external: semgrep exit 90',
          }),
        },
      ],
      blocking: { count: 0 },
    },
    isLoading: false,
    isError: false,
  })
  render(<SecurityScanSection taskId='t1' />, { wrapper })
  expect(screen.getAllByText(/external: semgrep exit 90/)).toHaveLength(1)
  expect(screen.getByTestId('external-failed-reason')).toHaveTextContent(
    'External scanner failed: external: semgrep exit 90'
  )
})

test('a complete scan renders no stages line; partial renders the budget notice', () => {
  useSecurityScans.mockReturnValue({
    data: {
      prs: [
        {
          pr,
          latest: scan({
            partial: true,
            stages: { secrets: 'RAN', external: 'PARTIAL', judge: 'RAN' },
            complete: false,
          }),
        },
      ],
      blocking: { count: 1 },
    },
    isLoading: false,
    isError: false,
  })
  render(<SecurityScanSection taskId='t1' />, { wrapper })
  expect(screen.getByTestId('scan-partial')).toBeInTheDocument()
  expect(screen.getByTestId('scan-stages')).toHaveTextContent(
    'External scanner: partial'
  )
})

test('a PENDING external stage renders "scanning" and no external-late warning', () => {
  useSecurityScans.mockReturnValue({
    data: {
      prs: [
        {
          pr,
          latest: scan({
            status: 'CLEAN',
            findings: [],
            stages: { secrets: 'RAN', external: 'PENDING', judge: 'RAN' },
            complete: false,
            externalLate: false,
          }),
        },
      ],
      blocking: { count: 0 },
    },
    isLoading: false,
    isError: false,
  })
  render(<SecurityScanSection taskId='t1' />, { wrapper })
  expect(screen.getByTestId('scan-stages')).toHaveTextContent(
    'External scanner: scanning'
  )
  expect(screen.queryByTestId('external-late')).toBeNull()
})

test('externalLate renders a warning that the scanner has not reported in 30 minutes', () => {
  useSecurityScans.mockReturnValue({
    data: {
      prs: [
        {
          pr,
          latest: scan({
            status: 'CLEAN',
            findings: [],
            stages: { secrets: 'RAN', external: 'PENDING', judge: 'RAN' },
            complete: false,
            externalLate: true,
          }),
        },
      ],
      blocking: { count: 0 },
    },
    isLoading: false,
    isError: false,
  })
  render(<SecurityScanSection taskId='t1' />, { wrapper })
  expect(screen.getByTestId('external-late')).toHaveTextContent(
    'Push a new commit to start a fresh scan'
  )
})

test('an EXTERNAL_TOOL finding links to the GitHub alert and shows no evidence block', () => {
  useSecurityScans.mockReturnValue({
    data: {
      prs: [
        {
          pr,
          latest: scan({
            findings: [
              finding({
                id: 'f-ext',
                kind: 'VULNERABILITY',
                ruleId: 'ext:semgrep-oss:js.sqli',
                severity: 'MEDIUM',
                provenance: 'EXTERNAL_TOOL',
                evidence: '',
                externalRef: 'https://github.com/o/r/security/code-scanning/7',
                blocking: false,
              }),
            ],
          }),
        },
      ],
      blocking: { count: 0 },
    },
    isLoading: false,
    isError: false,
  })
  render(<SecurityScanSection taskId='t1' />, { wrapper })
  const row = screen.getByTestId('security-finding-f-ext')
  expect(screen.getByTestId('finding-external-link')).toHaveAttribute(
    'href',
    'https://github.com/o/r/security/code-scanning/7'
  )
  expect(row.querySelector('pre')).toBeNull()
  expect(row).toHaveTextContent('External tool')
})
