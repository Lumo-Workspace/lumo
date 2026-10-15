/** @jest-environment jsdom */
/**
 * LUM-1144 — the web panel for a PR over the AI review's size cap: a
 * partial review names the skipped files and how to get them reviewed,
 * never our "didn't finish" line, never Clean; an over-cap by file count
 * says files, not characters.
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
import {
  isOverSizeLimitOnly,
  stageReason,
} from '@/ee/security/components/TaskDetailTimeline/security-summary'
import type { SecurityScanView } from '@/ee/security/services/pr-security-scan.service'
import {
  scanSizeCaps,
  hasSizeNotice,
} from '@/ee/security/security-scan/size-caps'
import {
  isOwnedUnfinished,
  scanCoverageState,
} from '@/shared/src/security-scan'

const SKIPPED_PATHS = Array.from({ length: 12 }, (_, i) => `lib/skipped${i}.ts`)

function view(over: {
  stages: Record<string, string>
  partialCauses: string[]
  judgeBudget: unknown
}): SecurityScanView {
  const base = {
    id: 's1',
    status: 'CLEAN',
    headSha: 'abcdef1234567',
    trigger: 'PR_EVENT',
    judgeStatus: 'RAN',
    truncated: true,
    stages: over.stages,
    partial: true,
    externalLate: false,
    error: null,
    startedAt: '2026-10-10T00:00:00Z',
    finishedAt: '2026-10-10T00:00:01Z',
    codeScrubbed: false,
    fixed: 0,
    findings: [],
    huntProgress: null,
  } as unknown as SecurityScanView
  const caps = scanSizeCaps({
    stages: over.stages,
    partialCauses: over.partialCauses,
    judgeBudget: over.judgeBudget,
  })
  const coverage = scanCoverageState(base)
  return {
    ...base,
    ...caps,
    coverage,
    complete: coverage === 'CHECKED',
    ownedUnfinished: isOwnedUnfinished({
      ...base,
      partialCauses: over.partialCauses,
      hasSizeNotice: hasSizeNotice(caps),
    }),
  }
}

const partial = () =>
  view({
    stages: { secrets: 'RAN', judge: 'PARTIAL' },
    partialCauses: ['JUDGE_PARTIAL_OVER_CAP'],
    judgeBudget: {
      diffChars: 190_000,
      tierChars: 180_000,
      reviewedChars: 170_000,
      coveredFiles: 60,
      droppedFiles: 12,
      overCap: {
        files: 72,
        capFiles: 150,
        capChars: 180_000,
        skippedPaths: SKIPPED_PATHS,
      },
    },
  })

const pr = {
  id: 'pr1',
  number: 1450,
  title: 'big change',
  url: 'https://github.com/o/r/pull/1450',
  state: 'open',
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

test('panel: a partial review lists skipped files and how to get them, no owned line', () => {
  const scan = partial()
  expect(scan.judgePartial).not.toBeNull()
  expect(scan.ownedUnfinished).toBe(false)
  expect(scan.coverage).toBe('UNFINISHED')
  renderPanel(scan)
  const notice = screen.getByTestId('scan-judge-partial')
  expect(notice).toHaveTextContent('covered 60 of 72 reviewable files')
  expect(notice).toHaveTextContent('request a full review')
  expect(notice).toHaveTextContent('lib/skipped0.ts')
  expect(notice).toHaveTextContent('lib/skipped9.ts')
  expect(notice).not.toHaveTextContent('lib/skipped10.ts')
  expect(notice).toHaveTextContent('and 2 more')
  expect(screen.queryByTestId('scan-unfinished')).toBeNull()
})

test('summary + stage reason: over the size limit, partly reviewed', () => {
  const scan = partial()
  expect(isOverSizeLimitOnly(scan)).toBe(true)
  expect(stageReason('judge', scan)).toEqual({
    id: 'securityScan.stageReason.judgePartial',
    values: { reviewed: 60, total: 72 },
  })
})

test('over the cap by file count alone: the notice says files, not characters', () => {
  const scan = view({
    stages: { secrets: 'RAN', judge: 'SKIPPED' },
    partialCauses: ['JUDGE_OVER_CAP'],
    judgeBudget: {
      diffChars: 90_000,
      tierChars: 180_000,
      reviewedChars: 0,
      coveredFiles: 0,
      droppedFiles: 240,
      overCap: {
        files: 240,
        capFiles: 150,
        capChars: 180_000,
        skippedPaths: ['a.ts'],
      },
    },
  })
  renderPanel(scan)
  const notice = screen.getByTestId('scan-judge-over-cap')
  expect(notice).toHaveTextContent('This PR changes 240 reviewable files')
  expect(notice).not.toHaveTextContent('characters')
  expect(stageReason('judge', scan)).toEqual({
    id: 'securityScan.stageReason.judgeOverCapFiles',
    values: { files: 240, cap: 150 },
  })
})
