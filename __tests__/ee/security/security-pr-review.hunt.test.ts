/** @jest-environment node */
// LUM-739: the PR summary comment's stage line includes the hunt layer.
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn(),
}))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {},
}))

import { SCAN_STAGE_DESCRIPTIONS as D } from '@/shared/src/security-scan'
import {
  buildSummary,
  SUMMARY_MARKER,
} from '@/ee/security/services/security-pr-review.service'

describe('LUM-739 hunt stage', () => {
  it('lists hunt after judge and reads a FAILED hunt as incomplete', () => {
    const body = buildSummary({
      headSha: 'abcdef1234567890',
      stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN', hunt: 'FAILED' },
      partial: false,
      externalCounts: {},
      open: 0,
      blocking: 0,
      error: null,
      taskUrl: null,
    })
    expect(body).toContain(
      `- **AI review** (checked): ${D.judge}\n- **Exploit paths** (⚠ didn't finish): ${D.hunt}`
    )
    // LUM-832: a FAILED layer is not "still running" — it is ours, and
    // unfinished.
    expect(body).toContain(
      "No open findings so far — part of this scan hasn't finished on our side — not counted as checked."
    )
    expect(body).toContain(SUMMARY_MARKER)
  })

  it('a RAN hunt with nothing open reads as clean', () => {
    const body = buildSummary({
      headSha: 'abcdef1234567890',
      stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN', hunt: 'RAN' },
      partial: false,
      externalCounts: {},
      open: 0,
      blocking: 0,
      error: null,
      taskUrl: null,
    })
    expect(body).toContain(`- **Exploit paths** (checked): ${D.hunt}`)
    expect(body).toContain('No open findings on lines this PR added.')
  })
})

describe('LUM-832 batched hunt', () => {
  it('the summary shows the covered share while batches are queued and says the scan is still running', () => {
    const body = buildSummary({
      headSha: 'abcdef1234567890',
      status: 'CLEAN',
      stages: { secrets: 'RAN', judge: 'RAN', hunt: 'PENDING' },
      partial: false,
      huntProgress: { coveredFiles: 40, totalFiles: 120 },
      externalCounts: {},
      open: 0,
      blocking: 0,
      error: null,
      taskUrl: null,
    })
    expect(body).toContain(
      '- **Exploit paths** (scanning · 40/120 source files): '
    )
    expect(body).toContain('No open findings yet — the scan is still running.')
  })
})
