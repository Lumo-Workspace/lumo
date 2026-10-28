/** @jest-environment node */
import {
  EXTERNAL_ERROR_PREFIX,
  externalFailureReason,
  isAgentReviewRuleId,
} from '../../shared/src/security-scan'
// LUM-1064: plugin cases live in __tests__/ee/security/shared/security-scan.test.ts.

/**
 * LUM-756 — the P8 provenance rule for `PrSecurityScan.error`, shared by the
 * web panel, the PR summary and the CLI so the three renderers cannot drift.
 */
describe('externalFailureReason', () => {
  it('returns the text after the provenance prefix', () => {
    expect(externalFailureReason('external: gitleaks exit 2')).toBe(
      'gitleaks exit 2'
    )
  })

  it('returns null for an unprefixed error (stage A raw crash text)', () => {
    expect(externalFailureReason('ENOTFOUND api.github.com')).toBeNull()
  })

  it('returns null for a missing error or a prefix with nothing after it', () => {
    expect(externalFailureReason(null)).toBeNull()
    expect(externalFailureReason(undefined)).toBeNull()
    expect(externalFailureReason('')).toBeNull()
    expect(externalFailureReason(EXTERNAL_ERROR_PREFIX)).toBeNull()
  })
})

describe('LUM-1321 isAgentReviewRuleId', () => {
  it('recognises rows imported from Claude Code and Codex reviews', () => {
    expect(isAgentReviewRuleId('ext:claude-code:sqli')).toBe(true)
    expect(isAgentReviewRuleId('ext:codex:idor')).toBe(true)
  })
  it('does not match CI scanners, look-alike slugs or non-external rules', () => {
    expect(isAgentReviewRuleId('ext:semgrep:js.sqli')).toBe(false)
    expect(isAgentReviewRuleId('ext:codex-security:x')).toBe(false)
    expect(isAgentReviewRuleId('ext:claude-code')).toBe(false)
    expect(isAgentReviewRuleId('secret:aws-key')).toBe(false)
    expect(isAgentReviewRuleId('claude-code:sqli')).toBe(false)
  })
})
