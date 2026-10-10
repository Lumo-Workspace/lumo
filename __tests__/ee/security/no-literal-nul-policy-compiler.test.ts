/**
 * LUM-796 — plugin half of __tests__/no-literal-nul-in-source.test.ts (split
 * in LUM-1065 when the policy compiler moved into ee/security/): the policy
 * compiler salts its sourceHash with a NUL separator written as an escape,
 * and the byte identity of that escape is pinned here.
 *
 * Note for anyone editing this file: never type the six-character escape
 * sequence directly into a heredoc or a tool payload — several layers decode
 * it back into the literal byte (the LUM-405 trap). Build it from
 * `BACKSLASH` below instead.
 */
import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'

const REPO_ROOT = join(__dirname, '../../..')
const NUL = String.fromCharCode(0)
const BACKSLASH = String.fromCharCode(92)
/** The 6 ASCII characters that spell the escape in TypeScript source. */
const NUL_ESCAPE = `${BACKSLASH}u0000`

it('NUL separators are byte-identical after escaping', () => {
  // The policy compiler salts its sourceHash with the same NUL separator, and
  // __tests__/ee/security/policy-compiler.service.test.ts reproduces that salt to seed a
  // *stale* hash. Production was already escaped, the test was not — so pin
  // the digest the test-side salt must keep producing.
  const source = '## Forbidden\n- Never push to main or develop directly'
  expect(
    createHash('sha256')
      .update([source, ''].join('\n\n'))
      .update(`\n${NUL}compiler:lum770`)
      .digest('hex')
  ).toBe('b47ef5f8c0970cacb9dd3884c248ad3adc8c81dc3ae53d90ebff4681af116a60')

  // Parity: both sides spell that separator as the same escape, so neither
  // can drift back to a literal byte without this test noticing.
  for (const rel of [
    'ee/security/services/policy/policy-compiler.service.ts',
    '__tests__/ee/security/policy-compiler.service.test.ts',
  ]) {
    const src = readFileSync(join(REPO_ROOT, rel), 'utf8')
    expect(src).toContain(`${NUL_ESCAPE}compiler:`)
    expect(src).not.toContain(NUL)
  }
})
