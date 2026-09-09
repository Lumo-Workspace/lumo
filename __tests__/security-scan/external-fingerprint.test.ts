/** @jest-environment node */
import { externalFingerprint } from '@/lib/security-scan/redact'

test('externalFingerprint is a 16-hex sha256 over ruleId:path:alertNumber', () => {
  const a = externalFingerprint('ext:semgrep:js.sqli', 'src/db.ts', 42)
  expect(a).toMatch(/^[0-9a-f]{16}$/)
  expect(externalFingerprint('ext:semgrep:js.sqli', 'src/db.ts', 42)).toBe(a)
  expect(externalFingerprint('ext:semgrep:js.sqli', 'src/db.ts', 43)).not.toBe(
    a
  )
  expect(
    externalFingerprint('ext:semgrep:js.sqli', 'src/other.ts', 42)
  ).not.toBe(a)
  expect(externalFingerprint('ext:codeql:js/sqli', 'src/db.ts', 42)).not.toBe(a)
})
