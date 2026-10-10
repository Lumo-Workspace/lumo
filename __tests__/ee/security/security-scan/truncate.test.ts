/** @jest-environment node */
import {
  truncateSecurityDiff,
  SECURITY_DIFF_MAX_CHARS,
} from '@/ee/security/security-scan/truncate'

test('truncateSecurityDiff keeps short diffs intact and flags long ones', () => {
  expect(truncateSecurityDiff('+a\n+b')).toEqual({
    text: '+a\n+b',
    truncated: false,
  })
  const long = 'x'.repeat(SECURITY_DIFF_MAX_CHARS + 10)
  const r = truncateSecurityDiff(long)
  expect(r.truncated).toBe(true)
  expect(r.text.length).toBeLessThanOrEqual(SECURITY_DIFF_MAX_CHARS + 40)
  expect(r.text.endsWith('\n[diff truncated]')).toBe(true)
})
