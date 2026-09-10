/** @jest-environment node */
// LUM-739: the PR summary comment's stage line includes the hunt layer.
jest.mock('@/lib/integrations/github/auth', () => ({
  getGithubInstallationToken: jest.fn(),
}))
jest.mock('@/lib/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {},
}))

import {
  buildSummary,
  SUMMARY_MARKER,
} from '@/lib/services/security-pr-review.service'

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
      '- secrets: RAN · external: RAN · judge: RAN · hunt: FAILED'
    )
    expect(body).toContain(
      'No open findings yet — the scan is still incomplete.'
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
    expect(body).toContain('· hunt: RAN')
    expect(body).toContain('No open findings on lines this PR added.')
  })
})
