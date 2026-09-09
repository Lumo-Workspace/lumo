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
    error: null,
    startedAt: '2026-09-03T00:00:00.000Z',
    finishedAt: null,
    findings,
  }) as SecurityScanView

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
  expect(badge().className).toContain('text-warning')
})
