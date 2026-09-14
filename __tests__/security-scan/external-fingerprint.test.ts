/** @jest-environment node */
import { sarifFingerprint } from '@/lib/security-scan/redact'

test('sarifFingerprint hashes ruleId:path:normalizedSnippet to 16 hex', () => {
  const a = sarifFingerprint(
    'ext:semgrep:js.sqli',
    'src/db.ts',
    '  const q = `x ${id}`  '
  )
  expect(a).toMatch(/^[0-9a-f]{16}$/)
  // whitespace-insensitive on the snippet so a reformat keeps the disposition
  expect(
    sarifFingerprint('ext:semgrep:js.sqli', 'src/db.ts', 'const q = `x ${id}`')
  ).toBe(a)
  expect(
    sarifFingerprint(
      'ext:semgrep:js.sqli',
      'src/other.ts',
      'const q = `x ${id}`'
    )
  ).not.toBe(a)
  expect(
    sarifFingerprint('ext:codeql:js/sqli', 'src/db.ts', 'const q = `x ${id}`')
  ).not.toBe(a)
  expect(sarifFingerprint('ext:semgrep:js.sqli', 'src/db.ts', '')).not.toBe(a)
})
