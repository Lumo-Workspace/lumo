/**
 * @jest-environment node
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
  getGithubInstallationToken: jest.fn(),
}))
jest.mock('@/lib/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {},
}))

import { readFileSync, readdirSync } from 'fs'
import path from 'path'
import { buildSummary } from '@/lib/services/security-pr-review.service'
import {
  SCAN_STAGE_STATE_LABELS,
  SCAN_UNFINISHED_NOTE,
} from '@/shared/src/security-scan'
import { formatScanLayerTail } from '@/cli/src/lib/scan-format'
import type { ScanStages } from '@/lib/security-scan/types'

const ROOT = path.resolve(__dirname, '../..')
const I18N = path.join(ROOT, 'lib/i18n')

/** Asks the reader to act. */
const ASKS_CUSTOMER =
  /\b(push|split|break (it )?up|smaller|re-?run|retry|try again|check your|reduce|shrink|please)\b/i
/** Blames the input for our own budget. */
const BLAMES_INPUT =
  /\b(budget|capped|cap|cut off|truncat\w*|oversized|large changes?|too (big|large))\b/i

/** The keys that describe a scan's completeness to the customer. */
function isScanStateKey(key: string): boolean {
  return (
    key === 'securityScan.partial' ||
    key === 'securityScan.external.late' ||
    key.startsWith('securityScan.stageState.') ||
    key.startsWith('securityScan.status.') ||
    key.startsWith('record.security.')
  )
}

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
  it('the web copy (en) neither asks the customer to act nor blames the input', () => {
    const en = locale('en')
    const keys = Object.keys(en).filter(isScanStateKey)
    expect(keys.length).toBeGreaterThan(10)
    for (const key of keys) {
      expect([key, en[key]]).not.toEqual([
        key,
        expect.stringMatching(ASKS_CUSTOMER),
      ])
      expect([key, en[key]]).not.toEqual([
        key,
        expect.stringMatching(BLAMES_INPUT),
      ])
    }
    // The two lines that named a specific (usually wrong) reason are gone.
    expect(en['securityScan.truncated']).toBeUndefined()
    expect(en['securityScan.judgeUnavailable']).toBeUndefined()
  })

  it('every locale carries its own translation of the rewritten copy, not the English one', () => {
    const en = locale('en')
    const rewritten = [
      'securityScan.partial',
      'securityScan.external.late',
      'securityScan.status.incomplete',
      'record.security.incomplete',
    ]
    const names = readdirSync(I18N)
      .filter(f => f.endsWith('.json'))
      .map(f => f.slice(0, -'.json'.length))
      .filter(n => !n.startsWith('en'))
    expect(names.length).toBeGreaterThan(10)
    for (const name of names) {
      const tr = locale(name)
      for (const key of rewritten) {
        expect([name, key, tr[key]]).not.toEqual([name, key, en[key]])
        expect(tr[key]).toBeTruthy()
      }
      expect(tr['securityScan.truncated']).toBeUndefined()
      expect(tr['securityScan.judgeUnavailable']).toBeUndefined()
    }
  })

  it('the shared labels the PR comment and CLI print are owned and ask nothing', () => {
    for (const text of [
      ...Object.values(SCAN_STAGE_STATE_LABELS),
      SCAN_UNFINISHED_NOTE,
    ]) {
      expect(text).not.toMatch(ASKS_CUSTOMER)
      expect(text).not.toMatch(BLAMES_INPUT)
    }
    expect(SCAN_UNFINISHED_NOTE).toMatch(/our side/)
  })

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

  it.each(SCAN_SHAPES)('the CLI scan line for %o asks nothing', shape => {
    const line = formatScanLayerTail({
      ...shape,
      externalFindings: 0,
      externalFailureReason: null,
    })
    expect(line).not.toMatch(ASKS_CUSTOMER)
    expect(line).not.toMatch(BLAMES_INPUT)
  })

  it('lumo pr scan no longer prints the input-blaming phrases', () => {
    const src = readFileSync(
      path.join(ROOT, 'cli/src/commands/pr-scan.ts'),
      'utf8'
    )
    expect(src).not.toContain('a corner of the diff')
    expect(src).not.toContain('diff truncated for AI review')
  })
})
