/** @jest-environment node */
import {
  EXTERNAL_ERROR_PREFIX,
  externalFailureReason,
} from '../../shared/src/security-scan'
import { EXTERNAL_ERROR_PREFIX as LIB_PREFIX } from '../../lib/security-scan/stages'

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

  it('is the same constant lib/security-scan/stages re-exports', () => {
    expect(LIB_PREFIX).toBe(EXTERNAL_ERROR_PREFIX)
    expect(EXTERNAL_ERROR_PREFIX).toBe('external: ')
  })
})
