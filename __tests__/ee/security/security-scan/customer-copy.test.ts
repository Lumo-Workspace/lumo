/**
 * @jest-environment node
 *
 * LUM-1064: plugin half of __tests__/security-scan/customer-copy.test.ts (split)
 *
 * LUM-832 — the copy a customer reads about a scan that did not finish.
 *
 * Two rules, pinned on every surface (web panel i18n, PR summary comment, CLI
 * `task status` / `pr scan`):
 *   1. no sentence asks the customer to do anything (push again, split the
 *      PR, check their CI) — an unfinished scan is ours to finish;
 *   2. no sentence blames the input for a budget we chose (cut off, capped,
 *      truncated, oversized, large changes).
 */
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn(),
}))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {},
}))

import { readFileSync } from 'fs'
import path from 'path'
import { buildSummary } from '@/ee/security/services/security-pr-review.service'
import {
  SCAN_UNFINISHED_NOTE,
  formatHuntOverCap,
  formatJudgeOverCap,
} from '@/shared/src/security-scan'
import {
  formatScanLayerTail,
  formatSizeCapLines,
} from '@/cli/src/lib/scan-format'
import type { ScanStages } from '@/ee/security/security-scan/types'

const ROOT = path.resolve(__dirname, '../../../..')
const I18N = path.join(ROOT, 'lib/i18n')

/** Asks the reader to act. */
const ASKS_CUSTOMER =
  /\b(push|split|break (it )?up|smaller|re-?run|retry|try again|check your|reduce|shrink|please)\b/i
const ASKS_CUSTOMER_G = new RegExp(ASKS_CUSTOMER.source, 'gi')
/** Blames the input for our own budget. */
const BLAMES_INPUT =
  /\b(budget|capped|cap|cut off|truncat\w*|oversized|large changes?|too (big|large))\b/i

function locale(name: string): Record<string, string> {
  return JSON.parse(readFileSync(path.join(I18N, `${name}.json`), 'utf8'))
}

const SUMMARY_BASE = {
  headSha: 'abcdef1234567890',
  externalCounts: {},
  open: 0,
  blocking: 0,
  error: null,
  taskUrl: null,
}

const SCAN_SHAPES: Array<{
  status: string
  stages: ScanStages
  partial: boolean
}> = [
  {
    status: 'CLEAN',
    stages: { secrets: 'RAN', judge: 'PARTIAL' },
    partial: true,
  },
  {
    status: 'CLEAN',
    stages: { secrets: 'RAN', hunt: 'FAILED' },
    partial: false,
  },
  {
    status: 'CLEAN',
    stages: { secrets: 'RAN', external: 'PENDING' },
    partial: false,
  },
  { status: 'FAILED', stages: { secrets: 'RAN' }, partial: false },
  { status: 'CLEAN', stages: { secrets: 'RAN', judge: 'RAN' }, partial: true },
]

describe('customer scan copy asks nothing of the customer', () => {
  it.each(SCAN_SHAPES)(
    'the PR summary for %o asks nothing and blames nothing',
    shape => {
      for (const open of [0, 2]) {
        const body = buildSummary({ ...SUMMARY_BASE, ...shape, open })
        expect(body).not.toMatch(ASKS_CUSTOMER)
        expect(body).not.toMatch(BLAMES_INPUT)
        // An unfinished scan is never summarised as clean.
        if (shape.status === 'FAILED' || shape.partial)
          expect(body).not.toContain('No open findings on lines this PR added.')
      }
    }
  )

  it('only the size-cap notices ask anything, and only when a layer was skipped for size', () => {
    // User rulings (LUM-832): a limit on the SIZE of the change is stated
    // plainly — too large, and how to get the layer. Nothing else
    // may ask; our own faults and shortfalls stay owned.
    const en = locale('en')
    expect(en['securityScan.huntOverCap']).toMatch(ASKS_CUSTOMER)
    expect(en['securityScan.judgeOverCap']).toMatch(ASKS_CUSTOMER)
    const huntOverCap = { sourceFiles: 200, capFiles: 150 }
    const judgeOverCap = { diffChars: 261_400, capChars: 180_000 }
    expect(formatHuntOverCap(huntOverCap)).toMatch(
      /did not run\. To get them, narrow the review scope or split the PR\.$/
    )
    expect(formatJudgeOverCap(judgeOverCap)).toMatch(
      /261,400 characters.*180,000.*did not run\. To get it, narrow the review scope or split the PR\.$/
    )
    const sizeOnly = buildSummary({
      ...SUMMARY_BASE,
      status: 'CLEAN',
      stages: { secrets: 'RAN', judge: 'SKIPPED', hunt: 'SKIPPED' },
      partial: true,
      partialCauses: ['JUDGE_OVER_CAP', 'HUNT_OVERSIZED'],
      huntOverCap,
      judgeOverCap,
    })
    expect(sizeOnly).toContain(formatHuntOverCap(huntOverCap))
    expect(sizeOnly).toContain(formatJudgeOverCap(judgeOverCap))
    // Every ask on the comment comes from those two notices, and no other line.
    const notices =
      formatHuntOverCap(huntOverCap) + formatJudgeOverCap(judgeOverCap)
    expect((sizeOnly.match(ASKS_CUSTOMER_G) ?? []).length).toBe(
      (notices.match(ASKS_CUSTOMER_G) ?? []).length
    )
    // A limit on the change's size is not dressed up as our failure…
    expect(sizeOnly).not.toContain(SCAN_UNFINISHED_NOTE)
    // …but a fault of ours on top of it is still owned.
    const sizeAndFault = buildSummary({
      ...SUMMARY_BASE,
      status: 'CLEAN',
      stages: { secrets: 'RAN', judge: 'SKIPPED', hunt: 'PARTIAL' },
      partial: true,
      partialCauses: ['JUDGE_OVER_CAP', 'HUNT_INCOMPLETE'],
      judgeOverCap,
    })
    expect(sizeAndFault).toContain(SCAN_UNFINISHED_NOTE)
    // Our own shortfalls never ask.
    const shortfall = buildSummary({
      ...SUMMARY_BASE,
      status: 'CLEAN',
      stages: { secrets: 'RAN', judge: 'RAN', hunt: 'PARTIAL' },
      partial: true,
      partialCauses: ['HUNT_BUDGET_SHORT'],
    })
    expect(shortfall).not.toMatch(ASKS_CUSTOMER)
    // The CLI says the same, on its own lines.
    expect(formatSizeCapLines({ huntOverCap, judgeOverCap })).toEqual([
      formatJudgeOverCap(judgeOverCap),
      formatHuntOverCap(huntOverCap),
    ])
    expect(
      formatScanLayerTail({
        status: 'CLEAN',
        stages: { secrets: 'RAN', judge: 'SKIPPED', hunt: 'SKIPPED' },
        partial: true,
        partialCauses: ['JUDGE_OVER_CAP', 'HUNT_OVERSIZED'],
        huntOverCap,
        judgeOverCap,
        externalFindings: 0,
        externalFailureReason: null,
      })
    ).not.toContain(SCAN_UNFINISHED_NOTE)
  })
})
