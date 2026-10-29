/** @jest-environment jsdom */
/**
 * LUM-1079 — the web panel and the PR badge for a PR too large to scan: the
 * reason and what to do, never "Scan didn't finish" / our unfinished line,
 * never Clean. A real fault of ours keeps the owned line.
 */
import { render, screen } from '@testing-library/react'

jest.mock('next/navigation', () => ({
  usePathname: () => '/workspace/acme/tasks/LUM-1',
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
// The real English copy, so the assertions read what a customer reads.

const en = require('@/lib/i18n/en.json') as Record<string, string>
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }, values?: Record<string, unknown>) =>
      (en[id] ?? id).replace(/\{(\w+)(?:, [^}]*)?\}/g, (_m, k: string) =>
        String(values?.[k] ?? '')
      ),
  }),
}))
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}))
jest.mock('@/ee/security/api-client', () => ({
  securityScanClient: { dispositionSecurityFinding: jest.fn() },
}))
const useSecurityScans = jest.fn()
jest.mock('@/ee/security/hooks/useSecurityScans', () => ({
  useSecurityScans: (id: string) => useSecurityScans(id),
}))

import { SecurityScanSection } from '@/ee/security/components/TaskDetailTimeline/SecurityScanSection'
import { SecurityScanBadge } from '@/ee/security/ui/pr-scan-badge'
import {
  summarizeSecurityScans,
  stageReason,
} from '@/ee/security/components/TaskDetailTimeline/security-summary'
import type { SecurityScanView } from '@/ee/security/services/pr-security-scan.service'
import {
  encodePrTooLarge,
  isOwnedUnfinished,
  prTooLargeOf,
  scanCoverageState,
} from '@/shared/src/security-scan'

const SKIPPED = {
  secrets: 'SKIPPED',
  external: 'SKIPPED',
  supplyChain: 'SKIPPED',
  judge: 'SKIPPED',
  hunt: 'SKIPPED',
} as const

/** A view as the server builds it (same shared rules). */
function view(over: Partial<SecurityScanView>): SecurityScanView {
  const base = {
    id: 's1',
    status: 'FAILED',
    headSha: 'abcdef1234567',
    trigger: 'PR_EVENT',
    judgeStatus: null,
    truncated: false,
    stages: {},
    partial: false,
    externalLate: false,
    error: null,
    startedAt: '2026-10-10T00:00:00Z',
    finishedAt: '2026-10-10T00:00:01Z',
    codeScrubbed: false,
    fixed: 0,
    findings: [],
    huntProgress: null,
    huntOverCap: null,
    judgeOverCap: null,
    judgePartial: null,
    ...over,
  } as SecurityScanView
  const causes = (over as { partialCauses?: string[] }).partialCauses ?? []
  const prTooLarge = prTooLargeOf({ partialCauses: causes, error: base.error })
  const coverage = scanCoverageState(base)
  return {
    ...base,
    prTooLarge,
    coverage,
    complete: coverage === 'CHECKED',
    ownedUnfinished: isOwnedUnfinished({
      ...base,
      partialCauses: causes,
      hasSizeNotice: prTooLarge !== null,
    }),
  }
}

const tooLarge = () =>
  view({
    stages: SKIPPED,
    partial: true,
    error: encodePrTooLarge({
      reason: 'FILE_LIMIT',
      changedFiles: 504,
      capFiles: 300,
    }),
    ...({ partialCauses: ['PR_TOO_LARGE'] } as object),
  })

const pr = {
  id: 'pr1',
  number: 1384,
  title: 'big refactor',
  url: 'https://github.com/o/r/pull/1384',
  state: 'merged',
}

function renderPanel(latest: SecurityScanView) {
  useSecurityScans.mockReturnValue({
    data: {
      prs: [{ pr, latest }],
      blocking: { count: 0 },
      suggested: { count: 0 },
      scanningOff: false,
    },
    isLoading: false,
    isError: false,
  })
  return render(<SecurityScanSection taskId='t1' />)
}

test('badge: too large, in the warning tone — not "didn\'t finish", not Clean', () => {
  render(<SecurityScanBadge scan={tooLarge()} />)
  const badge = screen.getByTestId('security-scan-badge')
  expect(badge).toHaveAttribute('data-state', 'too-large')
  expect(badge).toHaveTextContent(en['securityScan.status.tooLarge']!)
  expect(badge).not.toHaveTextContent(en['securityScan.status.FAILED']!)
  expect(badge).not.toHaveTextContent(en['securityScan.status.CLEAN']!)
  expect(badge.className).toContain('text-warning-text')
})

test('badge: a crash of ours still reads as failed', () => {
  render(<SecurityScanBadge scan={view({ error: 'boom' })} />)
  expect(screen.getByTestId('security-scan-badge')).toHaveAttribute(
    'data-state',
    'failed'
  )
})

test('panel: the notice says why and what to do; no owned line, no raw error', () => {
  renderPanel(tooLarge())
  const notice = screen.getByTestId('scan-pr-too-large')
  expect(notice).toHaveTextContent('This PR changes 504 files')
  expect(notice).toHaveTextContent('split it into smaller PRs')
  expect(screen.queryByTestId('scan-unfinished')).toBeNull()
  expect(screen.queryByText(/pr-too-large:/)).toBeNull()
  expect(document.body.textContent).not.toMatch(/hasn't finished on our side/i)
  // Every check is marked over the size cap (the PR-level notice above says why).
  expect(screen.getByTestId('stage-secrets')).toHaveAttribute(
    'data-check-state',
    'OVER_CAP'
  )
})

test('panel: over the file cap — the change is drawn against the cap', () => {
  renderPanel(tooLarge())
  expect(
    screen.getByTestId('scan-pr-too-large').querySelector('[aria-hidden]')
  ).not.toBeNull()
})

test('panel: GitHub refused the diff UNDER the file cap — the message, no over-cap bar', () => {
  renderPanel(
    view({
      stages: SKIPPED,
      partial: true,
      error: encodePrTooLarge({
        reason: 'DIFF_REFUSED',
        changedFiles: 120,
        capFiles: 300,
      }),
      ...({ partialCauses: ['PR_TOO_LARGE'] } as object),
    })
  )
  const notice = screen.getByTestId('scan-pr-too-large')
  expect(notice).toHaveTextContent('120 files changed')
  expect(notice.querySelector('[aria-hidden]')).toBeNull()
})

test('panel: GitHub refused the diff with no count — the message alone', () => {
  renderPanel(
    view({
      stages: SKIPPED,
      partial: true,
      error: null,
      ...({ partialCauses: ['PR_TOO_LARGE'] } as object),
    })
  )
  expect(screen.getByTestId('scan-pr-too-large')).toHaveTextContent(
    en['securityScan.prTooLarge.diffRefused']!
  )
})

test('panel: a real fault of ours (hunt timed out) keeps the owned line', () => {
  renderPanel(
    view({
      status: 'CLEAN',
      stages: { secrets: 'RAN', hunt: 'PARTIAL' },
      partial: true,
      ...({ partialCauses: ['HUNT_INCOMPLETE'] } as object),
    })
  )
  expect(screen.getByTestId('scan-unfinished')).toBeInTheDocument()
  expect(screen.queryByTestId('scan-pr-too-large')).toBeNull()
})

test('summary + stage reason: counted as over the size limit, never as incomplete or clean', () => {
  const s = summarizeSecurityScans([{ latest: tooLarge() }])
  expect(s).toMatchObject({ overSizeLimit: 1, incomplete: 0 })
  expect(stageReason('judge', tooLarge())).toEqual({
    id: 'securityScan.stageReason.prTooLarge',
  })
})

test('every locale translates the new copy (no English fallback, no TODO)', () => {
  const fs = require('fs') as typeof import('fs')
  const dir = `${process.cwd()}/lib/i18n`
  const keys = [
    'securityScan.status.tooLarge',
    'securityScan.prTooLarge.fileLimit',
    'securityScan.prTooLarge.diffRefusedFiles',
    'securityScan.prTooLarge.diffRefused',
    'securityScan.stageReason.prTooLarge',
  ]
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const msgs = JSON.parse(fs.readFileSync(`${dir}/${file}`, 'utf8'))
    for (const k of keys) {
      expect(typeof msgs[k]).toBe('string')
      expect(msgs[k]).not.toMatch(/\[TODO/)
      if (!file.startsWith('en')) expect(msgs[k]).not.toBe(en[k])
    }
  }
})
