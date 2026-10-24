import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react'

jest.mock('next/navigation', () => ({
  usePathname: () => '/workspace/acme/tasks/LUM-1',
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

const messages: Record<string, string> = {
  'securityScan.section.title': 'Lumo review',
  'securityScan.banner.blocking': 'blocking {count}',
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
  'securityScan.action.changeRuling': 'Change ruling',
  'securityScan.action.reopen': 'Reopen',
  'securityScan.action.reopenConfirm': 'Reopen this finding?',
  'securityScan.meta': 'Scanned {sha}',
  'securityScan.section.loadError': 'Could not load security scans.',
  'securityScan.provenance.EXTERNAL_TOOL': 'External tool',
  'securityScan.stage.secrets': 'Secret patterns',
  'securityScan.stage.external': 'External scanner',
  'securityScan.stage.hunt': 'Exploit paths',
  'securityScan.huntProgress': '{covered}/{total} source files',
  'securityScan.huntOverCap':
    'This PR touches {files} source files; exploit-path checks run on up to {cap}, so they did not run. To get them, narrow the review scope or split the PR.',
  'securityScan.judgeOverCap':
    "This PR's diff is {size} characters; AI review runs on up to {cap}, so it did not run. To get it, narrow the review scope or split the PR.",
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
  'securityScan.finding.persisting': 'already on the default branch',
  'securityScan.finding.dependency': 'Vulnerable dependency',
  'securityScan.result.verifierDismissed': '{count} dismissed by verifier',
  'record.security.preMergeNotPassed': '{count} pre-merge check not passed',
  'securityScan.result.noOpen': 'No open findings',
  'securityScan.stage.supplyChain': 'Dependencies',
  'securityScan.partial':
    "Part of this scan hasn't finished on our side yet. We aren't counting it as checked, and we won't call it clean.",
  'securityScan.external.failedReason': 'External scanner failed:',
  'lumoReview.check.secrets': 'Leaked secrets',
  'lumoReview.check.external': 'Risky code patterns',
  'lumoReview.check.supplyChain': 'Vulnerable packages',
  'lumoReview.check.judge': 'AI code review',
  'lumoReview.check.rewardHack': 'Agent shortcuts',
  'lumoReview.check.hunt': 'Attack paths',
  'lumoReview.result.found': '{count} found',
  'lumoReview.result.files': '{covered} of {total} files',
  'lumoReview.result.nothingFound': 'Nothing found',
  'lumoReview.result.off': 'Off',
  'lumoReview.result.didntFinish': "Didn't finish",
  'lumoReview.result.partlyChecked': 'Partly checked',
  'lumoReview.result.scanning': 'Scanning',
  'lumoReview.pr.view': 'View #{number}',
  'lumoReview.pr.moreClean': '{count} more pull requests',
  'securityScan.status.CLEAN': 'Clean',
  'securityScan.group.ruled': 'Decided',
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
jest.mock('@/ee/security/api-client', () => ({
  securityScanClient: {
    dispositionSecurityFinding: (...a: unknown[]) =>
      dispositionSecurityFinding(...a),
  },
}))
jest.mock('@/ee/security/ui/pr-scan-badge', () => ({
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
jest.mock(
  '@/ee/security/components/TaskDetailTimeline/RewardHackEvidence',
  () => ({
    RewardHackEvidence: (p: { taskId: string; findingId: string }) => (
      <div
        data-testid='reward-hack-evidence-stub'
        data-task={p.taskId}
        data-finding={p.findingId}
      />
    ),
  })
)
const useSecurityScans = jest.fn()
jest.mock('@/ee/security/hooks/useSecurityScans', () => ({
  useSecurityScans: (id: string) => useSecurityScans(id),
}))

import { SecurityScanSection } from '@/ee/security/components/TaskDetailTimeline/SecurityScanSection'
import { scanCoverageState } from '@/shared/src/security-scan'

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
  persisting: false,
  ...over,
})
// LUM-832: `coverage` is derived exactly as the server derives it, so a
// fixture that sets `partial` / a FAILED layer reads UNFINISHED on its own.
const scan = (over: object) => {
  const base = {
    ...scanFields(),
    ...over,
  } as ReturnType<typeof scanFields>
  const coverage = scanCoverageState(base)
  // No file cap in these fixtures: unfinished is always ours.
  return {
    ...base,
    coverage,
    ownedUnfinished: coverage === 'UNFINISHED',
    huntOverCap: null,
    judgeOverCap: null,
    judgePartial: null,
    ...over,
  }
}
const scanFields = () => ({
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
})
const pr = {
  id: 'pr1',
  number: 9,
  title: 'feat',
  url: 'https://github.com/o/r/pull/9',
  state: 'open',
}
const wrapper = ({ children }: { children: React.ReactNode }) => <>{children}</>

/** LUM-1308: open a check's fold, then (optionally) a quiet group in it. */
function openCheck(key: string) {
  fireEvent.click(screen.getByTestId(`check-${key}-toggle`))
}
function openGroup(testId: string) {
  fireEvent.click(within(screen.getByTestId(testId)).getAllByRole('button')[0]!)
}

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

test('shows the blocking banner, the owned unfinished notice for a judge outage, and finding rows', () => {
  useSecurityScans.mockReturnValue({
    data: {
      prs: [
        {
          pr,
          // An outage is stamped on the layer too (stage A: judge FAILED).
          latest: scan({
            judgeStatus: 'UNAVAILABLE',
            stages: { secrets: 'RAN', external: 'RAN', judge: 'FAILED' },
          }),
        },
      ],
      blocking: { count: 1 },
    },
    isLoading: false,
  })
  render(<SecurityScanSection taskId='t1' />)
  expect(screen.getByTestId('security-blocking-banner')).toHaveTextContent(
    'blocking 1'
  )
  // LUM-832: one owned line, not a judge-specific verdict.
  expect(screen.getByTestId('scan-unfinished')).toBeInTheDocument()
  expect(screen.getByTestId('security-finding-f1')).toHaveAttribute(
    'data-blocking',
    'true'
  )
  expect(screen.getByText('src/cfg.ts:3')).toBeInTheDocument()
  // LUM-1012: the scanned head rides on the PR link's title.
  expect(screen.getByTitle('Scanned abcdef1')).toBeInTheDocument()
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
  // LUM-1308: a ruled finding needs no decision, so its check stays folded
  // and it sits in the check's "Decided" group — open both to reach it.
  openCheck('secrets')
  openGroup('finding-group-ruled')
  expect(screen.getByTestId('finding-disposition')).toHaveTextContent(
    'False positive · carried over'
  )
  expect(screen.queryByText('Mark false positive')).toBeNull()
  expect(screen.queryByTestId('security-blocking-banner')).toBeNull()
})

test('LUM-1128: the web panel can correct an existing (e.g. CLI) ruling', async () => {
  useSecurityScans.mockReturnValue({
    data: {
      prs: [
        {
          pr,
          latest: scan({
            findings: [
              finding({ disposition: 'FALSE_POSITIVE', blocking: false }),
            ],
          }),
        },
      ],
      blocking: { count: 0 },
    },
    isLoading: false,
  })
  render(<SecurityScanSection taskId='t1' />)
  openCheck('secrets')
  openGroup('finding-group-ruled')
  if (!screen.queryByTestId('finding-change-ruling'))
    fireEvent.click(screen.getByText('AWS access key ID'))
  fireEvent.click(screen.getByTestId('finding-change-ruling'))
  // Only the other ruling is offered, plus Reopen (LUM-1128 follow-up).
  expect(screen.queryByText('Mark false positive')).toBeNull()
  expect(screen.getByTestId('finding-reopen')).toBeInTheDocument()
  fireEvent.click(screen.getByText('Accept risk'))
  fireEvent.change(screen.getByPlaceholderText('Why?'), {
    target: { value: 'real, carried' },
  })
  fireEvent.click(screen.getByText('Confirm'))
  await waitFor(() =>
    expect(dispositionSecurityFinding).toHaveBeenCalledWith('t1', 'f1', {
      disposition: 'ACCEPTED_RISK',
      note: 'real, carried',
    })
  )
})

test('LUM-1128 follow-up: the web panel can reopen a ruled finding (no note sent)', async () => {
  useSecurityScans.mockReturnValue({
    data: {
      prs: [
        {
          pr,
          latest: scan({
            findings: [
              finding({ disposition: 'FALSE_POSITIVE', blocking: false }),
            ],
          }),
        },
      ],
      blocking: { count: 0 },
    },
    isLoading: false,
  })
  render(<SecurityScanSection taskId='t1' />)
  openCheck('secrets')
  openGroup('finding-group-ruled')
  if (!screen.queryByTestId('finding-change-ruling'))
    fireEvent.click(screen.getByText('AWS access key ID'))
  fireEvent.click(screen.getByTestId('finding-change-ruling'))
  fireEvent.click(screen.getByTestId('finding-reopen'))
  // A confirm step that explains the consequence — no note field.
  expect(screen.getByText('Reopen this finding?')).toBeInTheDocument()
  expect(screen.queryByPlaceholderText('Why?')).toBeNull()
  fireEvent.click(screen.getByText('Confirm'))
  await waitFor(() =>
    expect(dispositionSecurityFinding).toHaveBeenCalledWith('t1', 'f1', {
      disposition: 'OPEN',
    })
  )
})

test('an open finding offers no Reopen', () => {
  useSecurityScans.mockReturnValue({
    data: {
      prs: [{ pr, latest: scan({ findings: [finding({})] }) }],
      blocking: { count: 1 },
    },
    isLoading: false,
  })
  render(<SecurityScanSection taskId='t1' />)
  expect(screen.getByTestId('security-finding-f1')).toBeInTheDocument()
  expect(screen.queryByTestId('finding-reopen')).toBeNull()
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
  // LUM-1308: a check that did not cover the PR opens on its own — its
  // notes are the reason the summary cannot claim a clean result.
  expect(screen.getByTestId('check-external-toggle')).toHaveAttribute(
    'aria-expanded',
    'true'
  )
  expect(screen.getByTestId('check-judge-toggle')).toHaveAttribute(
    'aria-expanded',
    'true'
  )
  // One row per check, its result in words on the label — checked ones too.
  expect(screen.getByLabelText('Risky code patterns: Off')).toBeInTheDocument()
  expect(
    screen.getByLabelText("AI code review: Didn't finish")
  ).toBeInTheDocument()
  expect(
    screen.getByLabelText('Leaked secrets: Nothing found')
  ).toBeInTheDocument()
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
  expect(reason).toHaveTextContent('External scanner failed: semgrep exit 90')
  // Not the FAILED-scan branch too — the reason renders exactly once.
  expect(screen.getAllByText(/semgrep exit 90/)).toHaveLength(1)
})

test('P8: an external failure whose error lacks the prefix renders no reason at all', () => {
  // Stage A stamps stages.external=FAILED on its own lookup failure and, on
  // its catch-all path, writes a RAW error.message into the same column. Only
  // the ingest workflow's scrubbed, prefixed text may be shown as the
  // scanner's reason.
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
            error: 'TypeError: boom',
          }),
        },
      ],
      blocking: { count: 0 },
    },
    isLoading: false,
    isError: false,
  })
  render(<SecurityScanSection taskId='t1' />, { wrapper })
  expect(screen.queryByTestId('external-failed-reason')).toBeNull()
  expect(screen.queryByText(/TypeError: boom/)).toBeNull()
  // The layer's cell still says it failed — the fact, not the text.
  expect(screen.getByTestId('stage-external')).toHaveAttribute(
    'data-check-state',
    'FAILED'
  )
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
  expect(screen.getAllByText(/semgrep exit 90/)).toHaveLength(1)
  expect(screen.getByTestId('external-failed-reason')).toHaveTextContent(
    'External scanner failed: semgrep exit 90'
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
  expect(screen.getByTestId('scan-unfinished')).toBeInTheDocument()
  expect(
    screen.getByLabelText('Risky code patterns: Partly checked')
  ).toBeInTheDocument()
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
  expect(
    screen.getByLabelText('Risky code patterns: Scanning')
  ).toBeInTheDocument()
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
  // LUM-1308: a late scanner is a warning, so its check opens by itself.
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
  // LUM-1308: the code scan holds several kinds, so the category shows.
  expect(row.querySelector('[data-testid="finding-kind"]')).not.toBeNull()
})

// LUM-496 Task 3 — summary line + collapsible per-PR rows.

test('an incomplete scan opens the check that did not finish (review F1)', () => {
  useSecurityScans.mockReturnValue({
    data: {
      prs: [
        {
          pr,
          latest: scan({
            status: 'CLEAN',
            findings: [],
            complete: false,
            partial: true,
            stages: { secrets: 'RAN', external: 'PARTIAL', judge: 'RAN' },
          }),
        },
      ],
      blocking: { count: 0 },
    },
    isLoading: false,
    isError: false,
  })
  render(<SecurityScanSection taskId='t1' />, { wrapper })
  expect(screen.getByTestId('check-external-toggle')).toHaveAttribute(
    'aria-expanded',
    'true'
  )
  expect(screen.getByTestId('scan-unfinished')).toBeInTheDocument()
})

// LUM-1308: one PR is shown as is, with a link to it on the PR's header.
test('a single PR has no tab or toggle, and its header links to the PR', () => {
  useSecurityScans.mockReturnValue({
    data: { prs: [{ pr, latest: scan({}) }], blocking: { count: 1 } },
    isLoading: false,
    isError: false,
  })
  render(<SecurityScanSection taskId='t1' />, { wrapper })
  expect(screen.getByTestId('security-pr-9')).toBeInTheDocument()
  expect(screen.queryByTestId('security-pr-9-toggle')).toBeNull()
  expect(screen.getByRole('link', { name: 'View #9' })).toHaveAttribute(
    'href',
    'https://github.com/o/r/pull/9'
  )
  // The finding's location links to the PR's changed files.
  expect(screen.getByTestId('finding-location')).toHaveAttribute(
    'href',
    'https://github.com/o/r/pull/9/files'
  )
})

// LUM-1308 review: a fold opened from first-render data must follow a
// refresh — a new finding on a check that was clean opens that check.
test('a check that gains an open finding on refresh opens', () => {
  useSecurityScans.mockReturnValue({
    data: {
      prs: [{ pr, latest: scan({ findings: [], status: 'CLEAN' }) }],
      blocking: { count: 0 },
    },
    isLoading: false,
    isError: false,
  })
  const { rerender } = render(<SecurityScanSection taskId='t1' />, {
    wrapper,
  })
  expect(screen.queryByTestId('check-secrets-toggle')).toBeNull()
  useSecurityScans.mockReturnValue({
    data: { prs: [{ pr, latest: scan({}) }], blocking: { count: 1 } },
    isLoading: false,
    isError: false,
  })
  rerender(<SecurityScanSection taskId='t1' />)
  expect(screen.getByTestId('check-secrets-toggle')).toHaveAttribute(
    'aria-expanded',
    'true'
  )
  expect(screen.getByTestId('security-finding-f1')).toBeInTheDocument()
})

// LUM-1308 review: ruling on the last open finding must not snap the check
// shut — the human keeps seeing what they just decided.
test('a check stays open when its last open finding is ruled on', () => {
  useSecurityScans.mockReturnValue({
    data: { prs: [{ pr, latest: scan({}) }], blocking: { count: 1 } },
    isLoading: false,
    isError: false,
  })
  const { rerender } = render(<SecurityScanSection taskId='t1' />, {
    wrapper,
  })
  expect(screen.getByTestId('check-secrets-toggle')).toHaveAttribute(
    'aria-expanded',
    'true'
  )
  useSecurityScans.mockReturnValue({
    data: {
      prs: [
        {
          pr,
          latest: scan({
            findings: [
              finding({ disposition: 'FALSE_POSITIVE', blocking: false }),
            ],
          }),
        },
      ],
      blocking: { count: 0 },
    },
    isLoading: false,
    isError: false,
  })
  rerender(<SecurityScanSection taskId='t1' />)
  expect(screen.getByTestId('check-secrets-toggle')).toHaveAttribute(
    'aria-expanded',
    'true'
  )
  expect(screen.getByTestId('finding-group-ruled')).toBeInTheDocument()
})

// P8 follow-up: a FAILED scan's prefixed error is still said when the
// external stage did not fail (so no scanner reason shows it).
test('a FAILED scan shows its prefixed error when the external stage did not fail', () => {
  useSecurityScans.mockReturnValue({
    data: {
      prs: [
        {
          pr,
          latest: scan({
            status: 'FAILED',
            findings: [],
            stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN' },
            complete: false,
            error: 'external: ingest key revoked',
          }),
        },
      ],
      blocking: { count: 0 },
    },
    isLoading: false,
    isError: false,
  })
  render(<SecurityScanSection taskId='t1' />, { wrapper })
  expect(screen.queryByTestId('external-failed-reason')).toBeNull()
  expect(screen.getAllByText(/ingest key revoked/)).toHaveLength(1)
})

test('a check with an undispositioned finding is open by default', () => {
  useSecurityScans.mockReturnValue({
    data: { prs: [{ pr, latest: scan({}) }], blocking: { count: 1 } },
    isLoading: false,
    isError: false,
  })
  render(<SecurityScanSection taskId='t1' />, { wrapper })
  expect(screen.getByTestId('check-secrets-toggle')).toHaveAttribute(
    'aria-expanded',
    'true'
  )
  // The row's own data-state stays Collapsible's open/closed.
  expect(screen.getByTestId('stage-secrets')).toHaveAttribute(
    'data-state',
    'open'
  )
  expect(screen.getByTestId('security-finding-f1')).toBeInTheDocument()
  // A clean check has nothing to fold.
  expect(screen.queryByTestId('check-judge-toggle')).toBeNull()
})

test('a clean scan is one line per check with nothing folded; scan-wide notes stay in view', () => {
  useSecurityScans.mockReturnValue({
    data: {
      prs: [
        {
          pr,
          latest: scan({ findings: [], status: 'CLEAN', fixed: 1 }),
        },
      ],
      blocking: { count: 0 },
    },
    isLoading: false,
    isError: false,
  })
  render(<SecurityScanSection taskId='t1' />, { wrapper })
  expect(screen.queryByTestId('check-secrets-toggle')).toBeNull()
  expect(
    screen.getByLabelText('Leaked secrets: Nothing found')
  ).toBeInTheDocument()
  expect(screen.queryByTestId('scan-unfinished')).toBeNull()
  expect(screen.getByTestId('scan-fixed')).toBeInTheDocument()
})

// LUM-1308: three or more PRs are listed by how much they need a look — the
// first one open — and the clean ones fold into one row.
test('three or more PRs: attention order, the first open, clean ones folded', () => {
  useSecurityScans.mockReturnValue({
    data: {
      prs: [
        {
          pr: { ...pr, id: 'pr2', number: 10 },
          latest: scan({ id: 's2', findings: [], status: 'CLEAN' }),
        },
        { pr, latest: null },
        {
          pr: { ...pr, id: 'pr3', number: 11 },
          latest: scan({ id: 's3' }),
        },
        {
          pr: { ...pr, id: 'pr4', number: 12 },
          latest: scan({ id: 's4', findings: [], status: 'CLEAN', fixed: 2 }),
        },
      ],
      blocking: { count: 1 },
    },
    isLoading: false,
    isError: false,
  })
  render(<SecurityScanSection taskId='t1' />, { wrapper })
  const blocking = screen.getByTestId('security-pr-11-toggle')
  const unscanned = screen.getByTestId('security-pr-9-toggle')
  expect(blocking).toHaveAttribute('aria-expanded', 'true')
  expect(unscanned).toHaveAttribute('aria-expanded', 'false')
  expect(
    blocking.compareDocumentPosition(unscanned) &
      Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
  // Clean PRs are folded into one row until it is opened.
  const clean = screen.getByTestId('security-pr-clean')
  expect(clean).toHaveTextContent('2 more pull requests')
  expect(screen.queryByTestId('security-pr-10-toggle')).toBeNull()
  openGroup('security-pr-clean')
  expect(screen.getByTestId('security-pr-10-toggle')).toBeInTheDocument()
  expect(screen.getByTestId('security-pr-12-toggle')).toBeInTheDocument()
})

test('an external-failed check with an error is open by default', () => {
  useSecurityScans.mockReturnValue({
    data: {
      prs: [
        {
          pr,
          latest: scan({
            status: 'CLEAN',
            findings: [],
            stages: { secrets: 'RAN', external: 'FAILED', judge: 'RAN' },
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
  expect(screen.getByTestId('check-external-toggle')).toHaveAttribute(
    'aria-expanded',
    'true'
  )
  expect(screen.getByTestId('external-failed-reason')).toBeInTheDocument()
})

// LUM-1308: two PRs sit in tabs, the one that needs a look selected first.
test('two PRs: tabs, the PR that needs a look selected first', () => {
  useSecurityScans.mockReturnValue({
    data: {
      prs: [
        {
          pr: { ...pr, id: 'pr2', number: 10 },
          latest: scan({ id: 's2', findings: [], status: 'CLEAN', fixed: 1 }),
        },
        { pr, latest: scan({}) },
      ],
      blocking: { count: 1 },
    },
    isLoading: false,
    isError: false,
  })
  render(<SecurityScanSection taskId='t1' />, { wrapper })
  const first = screen.getByTestId('security-pr-9-toggle')
  const second = screen.getByTestId('security-pr-10-toggle')
  expect(first).toHaveAttribute('role', 'tab')
  expect(first).toHaveAttribute('aria-selected', 'true')
  // Tabs follow attention order, so the selected tab is also the first one,
  // even though #10 came first in the data.
  expect(screen.getAllByRole('tab')[0]).toBe(first)
  expect(first).toHaveTextContent('#9')
  expect(screen.getByTestId('security-finding-f1')).toBeInTheDocument()
  fireEvent.mouseDown(second, { button: 0 })
  expect(second).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByTestId('scan-fixed')).toBeInTheDocument()
  expect(screen.queryByTestId('security-finding-f1')).toBeNull()
})

// LUM-738 — persisting (already on the default branch) vs new dependency rows.

test('LUM-738 supplyChain surface — a persisting dependency finding is muted, folded and labelled already-on-main; a new one is not, and comes first', () => {
  useSecurityScans.mockReturnValue({
    data: {
      prs: [
        {
          pr,
          latest: scan({
            stages: {
              secrets: 'RAN',
              external: 'RAN',
              supplyChain: 'RAN',
              judge: 'RAN',
            },
            findings: [
              finding({
                id: 'dep-new',
                kind: 'DEPENDENCY',
                ruleId: 'ext:osv-scanner:GHSA-1',
                severity: 'HIGH',
                provenance: 'EXTERNAL_TOOL',
                filePath: 'package-lock.json',
                line: null,
                evidence: '',
                externalRef: 'https://osv.dev/vulnerability/GHSA-1',
                blocking: false,
                persisting: false,
              }),
              finding({
                id: 'dep-old',
                kind: 'DEPENDENCY',
                ruleId: 'ext:osv-scanner:GHSA-2',
                severity: 'HIGH',
                provenance: 'EXTERNAL_TOOL',
                filePath: 'package-lock.json',
                line: null,
                evidence: '',
                externalRef: 'https://osv.dev/vulnerability/GHSA-2',
                blocking: false,
                persisting: true,
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
  // LUM-1308: both sit under Vulnerable packages; the quiet one is folded in
  // its "already on main" group.
  expect(screen.queryByTestId('security-finding-dep-old')).toBeNull()
  openGroup('finding-group-persisting')
  const fresh = screen.getByTestId('security-finding-dep-new')
  const old = screen.getByTestId('security-finding-dep-old')
  expect(fresh).toHaveAttribute('data-persisting', 'false')
  expect(fresh.className).not.toContain('opacity-60')
  expect(fresh).toHaveTextContent('Vulnerable dependency')
  expect(fresh.querySelector('[data-testid="finding-persisting"]')).toBeNull()
  expect(fresh.querySelector('.text-danger-text')).not.toBeNull()
  expect(old).toHaveAttribute('data-persisting', 'true')
  expect(old.className).toContain('opacity-60')
  // LUM-1012 follow-up: "already on main" is the group's heading, said once.
  expect(old.querySelector('[data-testid="finding-persisting"]')).toBeNull()
  expect(screen.getByTestId('finding-group-persisting')).toHaveTextContent(
    'already on the default branch · 1'
  )
  expect(old.querySelector('.text-danger-text')).toBeNull()
  // LUM-1012: the one to decide on comes first; the quiet one is folded.
  expect(
    fresh.compareDocumentPosition(old) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
  expect(old.querySelector('[data-testid="finding-toggle"]')).toHaveAttribute(
    'aria-expanded',
    'false'
  )
})

// LUM-832: a hunt run in batches over an oversized diff shows how much of the
// diff it has covered, on the stage row, while the rest is queued.
test('a batched hunt shows its covered share next to its state', () => {
  useSecurityScans.mockReturnValue({
    data: {
      prs: [
        {
          pr,
          latest: scan({
            stages: { secrets: 'RAN', judge: 'RAN', hunt: 'PENDING' },
            huntProgress: { coveredFiles: 40, totalFiles: 120 },
          }),
        },
      ],
      blocking: { count: 1 },
    },
    isLoading: false,
    isError: false,
  })
  render(<SecurityScanSection taskId='t1' />, { wrapper })
  expect(
    screen.getByLabelText('Attack paths: 40 of 120 files')
  ).toBeInTheDocument()
  // Queued batches are "in progress" — never the owned-unfinished line.
  expect(screen.queryByTestId('scan-unfinished')).toBeNull()
})

// LUM-832: a layer over its size cap did not run (an industry-standard size cap);
// the panel says the change is too large and how to get the layer — and does
// not call that limit a failure of ours.
test('a scan with layers over their size caps shows both notices instead of the owned unfinished line', () => {
  useSecurityScans.mockReturnValue({
    data: {
      prs: [
        {
          pr,
          latest: scan({
            partial: true,
            stages: { secrets: 'RAN', judge: 'SKIPPED', hunt: 'SKIPPED' },
            huntOverCap: { sourceFiles: 200, capFiles: 150 },
            judgeOverCap: { diffChars: 261400, capChars: 180000 },
            ownedUnfinished: false,
          }),
        },
      ],
      blocking: { count: 1 },
    },
    isLoading: false,
    isError: false,
  })
  render(<SecurityScanSection taskId='t1' />, { wrapper })
  expect(screen.getByTestId('scan-over-cap')).toHaveTextContent(
    'This PR touches 200 source files; exploit-path checks run on up to 150, so they did not run.'
  )
  expect(screen.getByTestId('scan-judge-over-cap')).toHaveTextContent(
    "This PR's diff is 261400 characters; AI review runs on up to 180000, so it did not run."
  )
  expect(screen.queryByTestId('scan-unfinished')).toBeNull()
})

// LUM-1012: a PR whose findings all need nobody's decision says what they are
// in its result cell — never "N findings" in the warning tone.
test('a PR with only verifier-rejected findings reads "dismissed by verifier", folded', () => {
  useSecurityScans.mockReturnValue({
    data: {
      prs: [
        {
          pr,
          latest: scan({
            findings: [
              finding({
                id: 'a',
                verifierVerdict: 'REJECTED',
                blocking: false,
              }),
              finding({
                id: 'b',
                verifierVerdict: 'REJECTED',
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
  expect(screen.getByTestId('scan-result-quiet')).toHaveTextContent(
    '2 dismissed by verifier'
  )
  expect(screen.queryByTestId('security-scan-badge')).toBeNull()
})

test('LUM-1234: a REWARD_HACK row shows the server-read evidence, never the raw event ids', () => {
  const evidence = JSON.stringify({ eventIds: ['ev1'], sessionIds: ['s1'] })
  useSecurityScans.mockReturnValue({
    data: {
      prs: [
        {
          pr,
          latest: scan({
            findings: [
              finding({
                id: 'rh1',
                kind: 'REWARD_HACK',
                ruleId: 'reward-hack/test-tampering',
                severity: 'MEDIUM',
                provenance: 'LLM_JUDGE',
                filePath: 'src/a.test.ts',
                line: null,
                title: 'Weakened an assertion',
                detail: 'Weakened an assertion',
                evidence,
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
  const stub = screen.getByTestId('reward-hack-evidence-stub')
  expect(stub).toHaveAttribute('data-task', 't1')
  expect(stub).toHaveAttribute('data-finding', 'rh1')
  expect(screen.getByTestId('security-finding-rh1')).not.toHaveTextContent(
    'ev1'
  )
})

test('LUM-1298: a clean scan with an unmet goal shows a warning and expandable checks', () => {
  useSecurityScans.mockReturnValue({
    data: {
      prs: [
        {
          pr,
          latest: scan({
            status: 'CLEAN',
            findings: [],
            preMergeChecks: [
              {
                id: 'issue-assessment',
                name: 'Issue assessment',
                mode: 'warning',
                verdict: 'failed',
                explanation: 'One goal is unmet',
                resolution: 'Implement the goal',
                requirements: [
                  {
                    id: 'goal',
                    label: 'LUM-702 · Goal',
                    outcome: 'not_addressed',
                    quotable: false,
                    text: 'Hidden goal',
                    explanation: 'Hidden explanation',
                  },
                ],
              },
            ],
          }),
        },
      ],
      blocking: { count: 0 },
    },
    isLoading: false,
    isError: false,
  })
  render(<SecurityScanSection taskId='t1' />)
  expect(screen.getByTestId('scan-result-pre-merge')).toHaveTextContent(
    '1 pre-merge check not passed'
  )
  expect(screen.getByTestId('security-scan-badge')).toBeInTheDocument()
  expect(screen.getByTestId('pre-merge-check')).toHaveTextContent(
    'One goal is unmet'
  )
  expect(screen.getByTestId('pre-merge-check')).toHaveTextContent(
    'Implement the goal'
  )
  expect(screen.getByTestId('pre-merge-check')).toHaveTextContent(
    'LUM-702 · Goal'
  )
  expect(screen.queryByText(/Hidden/)).toBeNull()
})
