/**
 * @jest-environment node
 *
 * LUM-1079 — the shared rule and the plain-text surfaces (PR summary comment,
 * agent reminder, reliability read-out) for a PR too large to scan.
 */
jest.mock('@/lib/integrations/github/pr-comment-client', () => {
  const actual = jest.requireActual(
    '@/lib/integrations/github/pr-comment-client'
  )
  return {
    GithubApiError: actual.GithubApiError,
    prCommentClient: {
      createIssueComment: jest.fn(),
      updateIssueComment: jest.fn(),
      createReview: jest.fn(),
      listIssueComments: jest.fn(),
      listReviewComments: jest.fn(),
    },
  }
})
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn(),
}))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {},
}))
jest.mock('@/ee/security/services/security-workspace-switches.service', () => ({
  loadSecurityLayers: jest.fn().mockResolvedValue({ scan: true }),
}))
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

import {
  GITHUB_DIFF_MAX_FILES,
  PR_TOO_LARGE_ERROR_PREFIX,
  SCAN_UNFINISHED_NOTE,
  encodePrTooLarge,
  formatPrTooLarge,
  isOwnedUnfinished,
  partialCauseClass,
  prTooLargeOf,
  scanCoverageState,
} from '@/shared/src/security-scan'
import { buildSummary } from '@/ee/security/services/security-pr-review.service'
import { renderUnconfirmedPrLine } from '@/ee/security/security-scan/agent-reminder'
import { summarizeScanReliability } from '@/ee/security/security-scan/reliability'
import {
  hasSizeNotice,
  scanSizeCaps,
} from '@/ee/security/security-scan/size-caps'

const SKIPPED = {
  secrets: 'SKIPPED',
  external: 'SKIPPED',
  supplyChain: 'SKIPPED',
  judge: 'SKIPPED',
  hunt: 'SKIPPED',
} as const
const FILE_LIMIT = {
  reason: 'FILE_LIMIT' as const,
  changedFiles: 504,
  capFiles: GITHUB_DIFF_MAX_FILES,
}

describe('shared rule', () => {
  test('the facts round-trip through the error column', () => {
    const error = encodePrTooLarge(FILE_LIMIT)
    expect(error.startsWith(PR_TOO_LARGE_ERROR_PREFIX)).toBe(true)
    expect(prTooLargeOf({ partialCauses: ['PR_TOO_LARGE'], error })).toEqual(
      FILE_LIMIT
    )
  })

  test('keyed on the cause: no cause → null; unparsable error → still too large, no numbers', () => {
    expect(
      prTooLargeOf({ partialCauses: [], error: encodePrTooLarge(FILE_LIMIT) })
    ).toBeNull()
    expect(
      prTooLargeOf({ partialCauses: ['PR_TOO_LARGE'], error: 'boom' })
    ).toEqual({
      reason: 'DIFF_REFUSED',
      changedFiles: null,
      capFiles: GITHUB_DIFF_MAX_FILES,
    })
    expect(
      prTooLargeOf({
        partialCauses: ['PR_TOO_LARGE'],
        error: `${PR_TOO_LARGE_ERROR_PREFIX}{not json`,
      })
    ).toMatchObject({ changedFiles: null })
  })

  test('the notice gives the reason and the advice, never our unfinished line', () => {
    const fileLimit = formatPrTooLarge(FILE_LIMIT)
    expect(fileLimit).toContain('This PR changes 504 files')
    expect(fileLimit).toContain('up to 300 files')
    expect(fileLimit).toContain('split it into smaller PRs or narrow its scope')
    const refused = formatPrTooLarge({
      reason: 'DIFF_REFUSED',
      changedFiles: null,
      capFiles: 300,
    })
    expect(refused).toContain("GitHub would not return this PR's diff")
    expect(refused).toContain('split it into smaller PRs or narrow its scope')
    for (const s of [fileLimit, refused])
      expect(s).not.toContain("hasn't finished")
  })

  test('never checked, never owned', () => {
    const s = {
      status: 'FAILED',
      stages: SKIPPED,
      partial: true,
      partialCauses: ['PR_TOO_LARGE'],
    }
    expect(scanCoverageState(s)).toBe('UNFINISHED')
    expect(isOwnedUnfinished({ ...s, hasSizeNotice: true })).toBe(false)
    // A crash of ours on the same FAILED status stays owned.
    expect(
      isOwnedUnfinished({
        status: 'FAILED',
        stages: {},
        partial: false,
        partialCauses: [],
        hasSizeNotice: false,
      })
    ).toBe(true)
    // The hunt not finishing (sandbox timeout) stays owned.
    expect(
      isOwnedUnfinished({
        status: 'CLEAN',
        stages: { secrets: 'RAN', hunt: 'PARTIAL' },
        partial: true,
        partialCauses: ['HUNT_INCOMPLETE'],
        hasSizeNotice: false,
      })
    ).toBe(true)
    expect(partialCauseClass('PR_TOO_LARGE')).toBe('COVERAGE_OWED')
  })

  test('size caps carry it, and it counts as a size notice', () => {
    const caps = scanSizeCaps({
      stages: SKIPPED,
      partialCauses: ['PR_TOO_LARGE'],
      error: encodePrTooLarge(FILE_LIMIT),
    })
    expect(caps.prTooLarge).toEqual(FILE_LIMIT)
    expect(hasSizeNotice(caps)).toBe(true)
    expect(
      hasSizeNotice(scanSizeCaps({ stages: { secrets: 'RAN' }, error: 'x' }))
    ).toBe(false)
  })
})

describe('PR summary comment', () => {
  const base = {
    headSha: 'abcdef1234567890',
    stages: SKIPPED,
    status: 'FAILED',
    partial: true,
    partialCauses: ['PR_TOO_LARGE'],
    externalCounts: {},
    open: 0,
    blocking: 0,
    error: encodePrTooLarge(FILE_LIMIT),
    taskUrl: null,
  }

  test('too large: says not scanned, why and what to do; not ours, not clean', () => {
    const body = buildSummary({ ...base, prTooLarge: FILE_LIMIT })
    expect(body).toContain('**Not scanned — this PR is too large.**')
    expect(body).toContain(`- ${formatPrTooLarge(FILE_LIMIT)}`)
    expect(body).not.toContain(SCAN_UNFINISHED_NOTE)
    expect(body).not.toContain('No open findings')
    // The prefixed facts are never printed raw.
    expect(body).not.toContain(PR_TOO_LARGE_ERROR_PREFIX)
  })

  test('a real fault of ours keeps the owned verdict', () => {
    const body = buildSummary({
      ...base,
      stages: { secrets: 'RAN' },
      partial: false,
      partialCauses: [],
      error: 'boom',
    })
    expect(body).toContain(`No open findings so far — ${SCAN_UNFINISHED_NOTE}`)
    expect(body).not.toContain('too large')
  })
})

test('agent reminder: a too-large PR is named as such, a failed one as failed', () => {
  expect(renderUnconfirmedPrLine({ number: 1384, reason: 'TOO_LARGE' })).toBe(
    '⚠ PR #1384: the PR is too large to scan, so nothing in it was scanned (split it or narrow its scope to get it scanned) — could not confirm it is clean.'
  )
  expect(renderUnconfirmedPrLine({ number: 9, reason: 'FAILED' })).toContain(
    'security scan FAILED'
  )
})

test('reliability: a too-large PR is not counted as our fault; a crash still is', () => {
  const r = summarizeScanReliability([
    {
      status: 'FAILED',
      stages: SKIPPED,
      partial: true,
      partialCauses: ['PR_TOO_LARGE'],
      huntAudit: null,
    },
    {
      status: 'FAILED',
      stages: {},
      partial: false,
      partialCauses: [],
      huntAudit: null,
    },
  ])
  expect(r.ourFault).toBe(1)
})
