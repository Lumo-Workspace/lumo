// LUM-740: the panel shows what the pipeline knows — stage row, kind /
// provenance / reachability, call chain, suggested-FP badge + reason,
// confirm-all, copy-for-agent, fixed-since-previous-scan.
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
  'securityScan.severity.HIGH': 'High',
  'securityScan.severity.MEDIUM': 'Medium',
  'securityScan.severity.LOW': 'Low',
  'securityScan.provenance.DETERMINISTIC': 'Pattern match',
  'securityScan.provenance.LLM_JUDGE': 'LLM review',
  'securityScan.provenance.EXTERNAL_TOOL': 'External tool',
  'securityScan.kind.SECRET': 'Secret',
  'securityScan.kind.VULNERABILITY': 'Vulnerability',
  'securityScan.kind.DEPENDENCY': 'Dependency',
  'securityScan.reachability.EXTERNAL': 'Reachable from an entry point',
  'securityScan.reachability.INTERNAL': 'Internal path only',
  'securityScan.reachability.UNKNOWN': 'Reachability unknown',
  'securityScan.stage.secrets': 'Secret patterns',
  'securityScan.stage.external': 'External scanner',
  'securityScan.stage.supplyChain': 'Dependencies',
  'securityScan.stage.judge': 'LLM review',
  'securityScan.stage.hunt': 'Vulnerability hunt',
  'securityScan.stageState.RAN': 'ran',
  'securityScan.stageState.SKIPPED': 'skipped',
  'securityScan.stageState.PENDING': 'scanning',
  'securityScan.stageState.FAILED': 'failed',
  'securityScan.callChain': 'Call chain',
  'securityScan.suggested.falsePositive': 'Suspected false positive (LLM)',
  'securityScan.suggested.reasonLabel': 'LLM reasoning:',
  'securityScan.suggested.outcome.CONFIRMED': 'suggestion confirmed',
  'securityScan.suggested.outcome.OVERRULED': 'suggestion overruled',
  'securityScan.action.confirmAllSuggested':
    'Confirm all {count} suspected false positives',
  'securityScan.action.copyForAgent': 'Copy for agent',
  'securityScan.action.copied': 'Copied',
  'securityScan.action.falsePositive': 'Mark false positive',
  'securityScan.action.acceptRisk': 'Accept risk',
  'securityScan.disposition.FALSE_POSITIVE': 'False positive',
  'securityScan.fixed': '{count} fixed since the previous scan',
  'securityScan.meta': 'Scanned {sha}',
  'record.security.summary': '{prs} PRs · {findings} findings{severityNote}',
  'record.security.allLow': 'all LOW',
  'record.security.prs': '{count} PRs',
  'record.security.noneOnComplete': 'no findings on completed scans',
  'record.security.incomplete': '{count} scan(s) incomplete',
  'record.security.failed': '{count} external scan(s) failed',
  'lumoReview.check.secrets': 'Leaked secrets',
  'lumoReview.check.external': 'Risky code patterns',
  'lumoReview.check.supplyChain': 'Vulnerable packages',
  'lumoReview.check.judge': 'AI code review',
  'lumoReview.check.hunt': 'Attack paths',
  'lumoReview.result.nothingFound': 'Nothing found',
  'lumoReview.result.notNeeded': 'Not needed',
  'lumoReview.result.scanning': 'Scanning',
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
const bulkDisposition = jest.fn().mockResolvedValue({ confirmed: 2 })
jest.mock('@/ee/security/api-client', () => ({
  securityScanClient: {
    dispositionSecurityFinding: jest.fn(),
    bulkDispositionSecurityFindings: (...a: unknown[]) => bulkDisposition(...a),
  },
}))
jest.mock('@/ee/security/ui/pr-scan-badge', () => ({
  SecurityScanBadge: () => <span data-testid='security-scan-badge' />,
}))
const useSecurityScans = jest.fn()
jest.mock('@/ee/security/hooks/useSecurityScans', () => ({
  useSecurityScans: (id: string) => useSecurityScans(id),
}))

import { SecurityScanSection } from '@/ee/security/components/TaskDetailTimeline/SecurityScanSection'

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
  evidence: '',
  fingerprint: 'fp',
  externalRef: null,
  disposition: null,
  dispositionNote: null,
  inherited: false,
  blocking: false,
  persisting: false,
  cwe: null,
  reachability: null,
  callChain: null,
  falsifierVerdict: null,
  suggestedDisposition: null,
  suggestedReason: null,
  suggestionOutcome: null,
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
  startedAt: '2026-09-11T00:00:00Z',
  finishedAt: null,
  fixed: 0,
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

function renderWith(latest: object, suggested = 0) {
  useSecurityScans.mockReturnValue({
    data: {
      prs: [{ pr, latest }],
      blocking: { count: 0 },
      suggested: { count: suggested },
    },
    isLoading: false,
    isError: false,
  })
  return render(<SecurityScanSection taskId='t1' />)
}

// jsdom lacks ResizeObserver, which the Radix tooltip references.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

/** LUM-1308: open a check's fold, then (optionally) a quiet group in it. */
function openCheck(key: string) {
  fireEvent.click(screen.getByTestId(`check-${key}-toggle`))
}
function openGroup(testId: string) {
  fireEvent.click(within(screen.getByTestId(testId)).getAllByRole('button')[0]!)
}

beforeEach(() => {
  jest.clearAllMocks()
  Object.assign(navigator, { clipboard: { writeText: jest.fn() } })
})

describe('LUM-740 panel', () => {
  test('stage row lists every layer the scan ran, dependencies and hunt included', () => {
    renderWith(
      scan({
        stages: {
          secrets: 'RAN',
          external: 'RAN',
          supplyChain: 'RAN',
          judge: 'RAN',
          hunt: 'PENDING',
        },
        complete: false,
      })
    )
    // LUM-1308: one row per check, in display order, its state on the row.
    expect(
      screen
        .getAllByTestId(/^stage-/)
        .map(el => [
          el.getAttribute('data-testid'),
          el.getAttribute('data-check-state'),
        ])
    ).toEqual([
      ['stage-secrets', 'RAN'],
      ['stage-external', 'RAN'],
      ['stage-supplyChain', 'RAN'],
      ['stage-judge', 'RAN'],
      ['stage-hunt', 'PENDING'],
    ])
    expect(screen.getByLabelText('Attack paths: Scanning')).toBeInTheDocument()
  })

  test('a layer that did not run says why in its fold; a checked one has nothing to fold', () => {
    renderWith(
      scan({
        findings: [],
        stages: {
          secrets: 'RAN',
          external: 'RAN',
          supplyChain: 'SKIPPED',
          judge: 'RAN',
          hunt: 'SKIPPED',
        },
      })
    )
    // A checked layer with nothing found is one plain line.
    expect(screen.queryByTestId('check-secrets-toggle')).toBeNull()
    expect(
      screen.getByLabelText('Leaked secrets: Nothing found')
    ).toBeInTheDocument()
    // A skipped one starts folded (not a warning) and says why when opened —
    // in the page, never hover-only.
    const hunt = screen.getByTestId('check-hunt-toggle')
    expect(hunt).toHaveAttribute('aria-expanded', 'false')
    expect(hunt).toHaveAccessibleName('Attack paths: Not needed')
    openCheck('hunt')
    expect(
      within(screen.getByTestId('stage-hunt')).getByTestId('check-reason')
    ).toHaveTextContent('securityScan.stageReason.huntSkipped')
  })

  test('each layer shows its name and an info button that says what it checks', async () => {
    renderWith(
      scan({
        stages: {
          secrets: 'RAN',
          external: 'RAN',
          supplyChain: 'RAN',
          judge: 'RAN',
          hunt: 'SKIPPED',
        },
      })
    )
    // The names ride on the row — no separate header to line up with.
    const row = screen.getByTestId('security-pr-9')
    expect(row).toHaveTextContent('Risky code patterns')
    expect(row).toHaveTextContent('Attack paths')
    // Code scan: what it checks plus the scanners behind it.
    fireEvent.click(screen.getByTestId('layer-info-external'))
    const external = await screen.findByTestId('layer-info-external-content')
    expect(external).toHaveTextContent('securityScan.stageInfo.external')
    expect(external).toHaveTextContent('securityScan.stageInfo.tools')
    // AI review has no third-party scanner to name.
    fireEvent.click(screen.getByTestId('layer-info-judge'))
    const judge = await screen.findByTestId('layer-info-judge-content')
    expect(judge).toHaveTextContent('securityScan.stageInfo.judge')
    expect(judge).not.toHaveTextContent('securityScan.stageInfo.tools')
  })

  test('a hunt finding shows kind, provenance, reachability, CWE and an expandable call chain', () => {
    renderWith(
      scan({
        findings: [
          finding({
            id: 'h1',
            kind: 'VULNERABILITY',
            ruleId: 'hunt:idor',
            severity: 'MEDIUM',
            provenance: 'LLM_JUDGE',
            title: 'IDOR on PATCH',
            cwe: 'CWE-639',
            reachability: 'EXTERNAL',
            callChain: [
              {
                from: 'app/api/tasks/[id]/route.ts#PATCH',
                to: 'taskService.update',
              },
              { from: 'taskService.update', to: 'prisma.task.update' },
            ],
          }),
        ],
      })
    )
    const row = screen.getByTestId('security-finding-h1')
    // LUM-1308: under Attack paths the check already names the kind.
    expect(row.querySelector('[data-testid="finding-kind"]')).toBeNull()
    expect(row).toHaveTextContent('LLM review')
    expect(row).toHaveTextContent('Reachable from an entry point')
    expect(row).toHaveTextContent('CWE-639')
    fireEvent.click(screen.getByText('Call chain'))
    expect(screen.getByTestId('finding-call-chain')).toHaveTextContent(
      'app/api/tasks/[id]/route.ts#PATCH → taskService.update'
    )
    expect(screen.getByTestId('finding-call-chain')).toHaveTextContent(
      'taskService.update → prisma.task.update'
    )
  })

  test('a suggested false positive shows the badge and the reasoning; a decided one shows the outcome', () => {
    renderWith(
      scan({
        findings: [
          finding({
            id: 's1',
            provenance: 'EXTERNAL_TOOL',
            ruleId: 'ext:gitleaks:aws',
            suggestedDisposition: 'FALSE_POSITIVE',
            suggestedReason:
              'the value is the documented AKIA…EXAMPLE placeholder',
          }),
          finding({
            id: 's2',
            provenance: 'EXTERNAL_TOOL',
            ruleId: 'ext:gitleaks:aws',
            suggestedDisposition: 'FALSE_POSITIVE',
            suggestedReason: 'test fixture',
            disposition: 'FALSE_POSITIVE',
            suggestionOutcome: 'CONFIRMED',
          }),
        ],
      })
    )
    const open = screen.getByTestId('security-finding-s1')
    expect(open).toHaveTextContent('Suspected false positive (LLM)')
    expect(open).toHaveTextContent(
      'LLM reasoning: the value is the documented AKIA…EXAMPLE placeholder'
    )
    // The decided one sits folded in its check's "Decided" group.
    openGroup('finding-group-ruled')
    expect(screen.getByTestId('security-finding-s2')).toHaveTextContent(
      'suggestion confirmed'
    )
  })

  test('the confirm-all control confirms every suggestion through the bulk route and refreshes', async () => {
    renderWith(scan({}), 2)
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Confirm all 2 suspected false positives',
      })
    )
    await waitFor(() => expect(bulkDisposition).toHaveBeenCalledWith('t1'))
    await waitFor(() => expect(invalidateQueries).toHaveBeenCalled())
  })

  test('no confirm-all control when nothing is suggested', () => {
    renderWith(scan({}), 0)
    expect(
      screen.queryByRole('button', { name: /suspected false positives/ })
    ).toBeNull()
  })

  test('copy for agent puts a self-contained context block on the clipboard', () => {
    renderWith(
      scan({
        findings: [
          finding({
            id: 'c1',
            provenance: 'EXTERNAL_TOOL',
            ruleId: 'ext:semgrep:cmd-injection',
            title: 'Command injection',
            detail: 'User input reaches exec.',
            externalRef: 'https://semgrep.dev/r/x',
            filePath: 'lib/run.ts',
            line: 12,
          }),
        ],
      })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Copy for agent' }))
    const text = (navigator.clipboard.writeText as jest.Mock).mock.calls[0][0]
    expect(text).toContain('lib/run.ts:12')
    expect(text).toContain('ext:semgrep:cmd-injection')
    expect(text).toContain('Command injection')
    expect(text).toContain('User input reaches exec.')
    expect(text).toContain('https://semgrep.dev/r/x')
    expect(text).toContain('PR #9')
  })

  test('says how many findings the latest push fixed', () => {
    renderWith(scan({ fixed: 2 }))
    expect(screen.getByTestId('scan-fixed')).toHaveTextContent(
      '2 fixed since the previous scan'
    )
    renderWith(scan({ fixed: 0 }))
    expect(screen.getAllByTestId('scan-fixed')).toHaveLength(1)
  })
})

describe('LUM-988 verifier-rejected finding in the panel', () => {
  test('shows the rejected badge and the verifier reason; an unverified row shows neither', () => {
    renderWith(
      scan({
        findings: [
          finding({
            id: 'rej',
            provenance: 'LLM_JUDGE',
            kind: 'CORRECTNESS',
            severity: 'MEDIUM',
            verifierVerdict: 'REJECTED',
            verifierReason: 'guarded at src/a.ts:12',
          }),
          finding({ id: 'plain', verifierVerdict: null, verifierReason: null }),
        ],
      })
    )
    // LUM-1308: the unverified secret is open under Leaked secrets; the
    // rejected bug is folded under AI code review, which has nothing to
    // decide and starts closed.
    expect(screen.getByTestId('security-finding-plain')).toBeInTheDocument()
    expect(screen.queryByTestId('security-finding-rej')).toBeNull()
    openCheck('judge')
    // The rejection is said once, as its group's heading — not as a chip.
    expect(
      screen.getByTestId('finding-group-verifierRejected')
    ).toHaveTextContent('securityScan.group.verifierRejected · 1')
    openGroup('finding-group-verifierRejected')
    expect(screen.queryByTestId('finding-verifier-rejected')).toBeNull()
    // LUM-1012: nothing to decide, so it is folded to one line; the reason
    // is one click away.
    expect(screen.queryByTestId('finding-verifier-reason')).toBeNull()
    fireEvent.click(screen.getByTestId('finding-toggle'))
    expect(screen.getByTestId('finding-verifier-reason')).toHaveTextContent(
      'guarded at src/a.ts:12'
    )
  })
})

describe('LUM-1012 finding groups', () => {
  test('queue exits of different kinds get their own group, each with a distinct test id', () => {
    renderWith(
      scan({
        findings: [
          finding({ id: 'merged', queueExit: 'MERGED_UNREVIEWED' }),
          finding({ id: 'closed', queueExit: 'PR_CLOSED' }),
        ],
      })
    )
    // Nothing to decide, so the check starts folded — open it.
    openCheck('secrets')
    const ids = screen
      .getAllByTestId(/^finding-group-/)
      .map(el => el.getAttribute('data-testid'))
    expect(ids).toEqual([
      'finding-group-queueExit-MERGED_UNREVIEWED',
      'finding-group-queueExit-PR_CLOSED',
    ])
    expect(new Set(ids).size).toBe(ids.length)
  })
})
