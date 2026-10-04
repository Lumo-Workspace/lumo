/** @jest-environment jsdom */
/**
 * LUM-732 review I7 — the PR-row security badge had no direct test: every
 * state was only ever exercised through a parent that stubbed the badge out.
 * It is the whole security signal on the PR list, so each state is pinned
 * here: which `data-state` it reports and which semantic tone it carries.
 */
import { render, screen } from '@testing-library/react'

const messages: Record<string, string> = {
  'securityScan.status.none': 'Not scanned',
  'securityScan.status.unavailable': 'Scan status unavailable',
  'securityScan.status.RUNNING': 'Scanning',
  'securityScan.status.PENDING': 'Queued',
  'securityScan.status.FAILED': 'Scan failed',
  'securityScan.status.CLEAN': 'Clean',
  'securityScan.status.FINDINGS': '{count} findings',
  'securityScan.status.incomplete': 'Scan incomplete',
  'securityScan.status.pendingExternal': 'Waiting for scanner',
  'securityScan.status.overSizeLimit': 'Over the size limit',
}
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }, values?: Record<string, unknown>) =>
      (messages[id] ?? id).replace(/\{(\w+)\}/g, (_m, k: string) =>
        String(values?.[k] ?? '')
      ),
  }),
}))

import { SecurityScanBadge } from '@/app/workspace/[workspaceUrl]/components/pr-helpers'
import type {
  SecurityFindingView,
  SecurityScanView,
} from '@/lib/services/pr-security-scan.service'

const finding = (severity: 'LOW' | 'MEDIUM' | 'HIGH'): SecurityFindingView =>
  ({
    id: `f-${severity}`,
    kind: 'SECRET',
    ruleId: 'secret:x',
    severity,
    provenance: 'DETERMINISTIC',
    filePath: 'src/a.ts',
    line: 1,
    title: 't',
    detail: 'd',
    evidence: 'e',
    fingerprint: 'fp',
    disposition: null,
    dispositionNote: null,
    inherited: false,
    blocking: severity === 'HIGH',
  }) as SecurityFindingView

const scan = (
  status: SecurityScanView['status'],
  findings: SecurityFindingView[] = []
): SecurityScanView =>
  ({
    id: 's1',
    status,
    headSha: 'abcdef1234',
    trigger: 'PR_EVENT',
    judgeStatus: 'RAN',
    truncated: false,
    stages: { secrets: 'RAN', judge: 'RAN' },
    partial: false,
    complete: true,
    externalLate: false,
    error: null,
    startedAt: '2026-09-03T00:00:00.000Z',
    finishedAt: null,
    findings,
  }) as SecurityScanView

const wrapper = ({ children }: { children: React.ReactNode }) => <>{children}</>

const badge = () => screen.getByTestId('security-scan-badge')

it('reports "none" when the PR has never been scanned', () => {
  render(<SecurityScanBadge scan={null} />)
  expect(badge()).toHaveAttribute('data-state', 'none')
  expect(badge()).toHaveTextContent('Not scanned')
})

it('reports "unavailable" when the scan status could not be loaded', () => {
  // Review I4: a failed fetch used to render as "Not scanned" — a claim about
  // the PR, made from an absence of data about it.
  render(<SecurityScanBadge scan={null} unavailable />)
  expect(badge()).toHaveAttribute('data-state', 'unavailable')
  expect(badge()).toHaveTextContent('Scan status unavailable')
})

it('reports "scanning" while the scan is RUNNING', () => {
  render(<SecurityScanBadge scan={scan('RUNNING')} />)
  expect(badge()).toHaveAttribute('data-state', 'scanning')
})

it('reports "failed" when the scan itself errored', () => {
  render(<SecurityScanBadge scan={scan('FAILED')} />)
  expect(badge()).toHaveAttribute('data-state', 'failed')
})

it('reports "clean" for a finished scan with no findings', () => {
  render(<SecurityScanBadge scan={scan('FINDINGS')} />)
  expect(badge()).toHaveAttribute('data-state', 'clean')
  expect(badge().className).toContain('text-success')
})

it('counts the findings and takes its tone from the WORST severity', () => {
  render(
    <SecurityScanBadge
      scan={scan('FINDINGS', [finding('LOW'), finding('HIGH')])}
    />
  )
  expect(badge()).toHaveAttribute('data-state', 'findings')
  expect(badge()).toHaveTextContent('2')
  expect(badge().className).toContain('text-destructive')
})

it('tones a MEDIUM-only result as a warning, not a destructive one', () => {
  render(<SecurityScanBadge scan={scan('FINDINGS', [finding('MEDIUM')])} />)
  expect(badge()).toHaveClass('text-warning-text')
})

it('reports "incomplete" — never "clean" — when a layer failed or is not configured', () => {
  render(
    <SecurityScanBadge
      scan={{
        ...scan('CLEAN'),
        stages: { secrets: 'RAN', external: 'NOT_CONFIGURED', judge: 'RAN' },
        complete: false,
      }}
    />,
    { wrapper }
  )
  expect(badge()).toHaveAttribute('data-state', 'incomplete')
  expect(badge()).toHaveTextContent('Scan incomplete')
})

it('still counts findings when present, even if the scan is incomplete', () => {
  render(
    <SecurityScanBadge
      scan={{ ...scan('FINDINGS', [finding('MEDIUM')]), complete: false }}
    />,
    { wrapper }
  )
  expect(badge()).toHaveAttribute('data-state', 'findings')
})

it('reports "scanning" — not "incomplete" — while the scanner has not reported for this sha yet', () => {
  // LUM-735: stages.external === 'PENDING' means the repo has pushed SARIF
  // before but not yet for this commit — still in progress, not stalled.
  render(
    <SecurityScanBadge
      scan={{
        ...scan('CLEAN'),
        stages: { secrets: 'RAN', external: 'PENDING', judge: 'RAN' },
        complete: false,
      }}
    />,
    { wrapper }
  )
  expect(badge()).toHaveAttribute('data-state', 'scanning')
  expect(badge()).toHaveTextContent('Waiting for scanner')
})

// LUM-832: a scan that skipped a layer only because the change was over its
// size cap reads "Over the size limit", not "Scan incomplete" — nothing is
// coming later, and it is never green either.
it('reports "over the size limit" for a clean scan skipped for size, not incomplete', () => {
  render(
    <SecurityScanBadge
      scan={
        {
          ...scan('CLEAN'),
          complete: false,
          coverage: 'UNFINISHED',
          ownedUnfinished: false,
          huntOverCap: { sourceFiles: 151, capFiles: 150 },
          judgeOverCap: null,
        } as SecurityScanView
      }
    />,
    { wrapper }
  )
  expect(badge()).toHaveAttribute('data-state', 'over-size-limit')
  expect(badge()).toHaveTextContent('Over the size limit')
  expect(badge()).toHaveClass('text-warning-text')
})

it('a size-capped scan with a fault of ours on top still reads incomplete', () => {
  render(
    <SecurityScanBadge
      scan={
        {
          ...scan('CLEAN'),
          complete: false,
          coverage: 'UNFINISHED',
          ownedUnfinished: true,
          huntOverCap: { sourceFiles: 151, capFiles: 150 },
          judgeOverCap: null,
        } as SecurityScanView
      }
    />,
    { wrapper }
  )
  expect(badge()).toHaveAttribute('data-state', 'incomplete')
})
