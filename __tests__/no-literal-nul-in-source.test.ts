/**
 * LUM-796 — a literal NUL byte in a tracked source file makes text tooling
 * lie about that file:
 *
 *   grep      -> exit 1, no output at all (a silent false negative)
 *   rg        -> "binary file matches", never the matching lines
 *   git grep  -> same, when the NUL lands in the first 8 KB it sniffs
 *
 * Searching a symbol then reads as "this file doesn't have it" rather than
 * "I refuse to show you". LUM-795 lost time to exactly that in
 * lib/services/boundary-detector.service.ts.
 *
 * Using NUL as a string separator is fine — it cannot occur in real content.
 * Writing it as a literal byte instead of an escape is what breaks tooling,
 * so this file guards the invariant (no literal NUL) and pins the byte
 * identity of the escape (same hashes as before the change).
 *
 * Note for anyone editing this file: never type the six-character escape
 * sequence directly into a heredoc or a tool payload — several layers decode
 * it back into the literal byte this test exists to forbid (the LUM-405
 * trap). Build it from `BACKSLASH` below instead.
 */
import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'

const REPO_ROOT = join(__dirname, '..')
const NUL = String.fromCharCode(0)
const BACKSLASH = String.fromCharCode(92)
/** The 6 ASCII characters that spell the escape in TypeScript source. */
const NUL_ESCAPE = `${BACKSLASH}u0000`

function trackedTypeScriptFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '-z', '*.ts', '*.tsx'], {
    cwd: REPO_ROOT,
    maxBuffer: 64 * 1024 * 1024,
  })
  return out.toString('utf8').split(NUL).filter(Boolean)
}

it('no tracked TypeScript source contains a literal NUL byte', () => {
  const files = trackedTypeScriptFiles()

  // Guard the guard: a broken `git ls-files` would make the assertion below
  // pass vacuously on an empty list.
  expect(files.length).toBeGreaterThan(1000)

  const offenders = files.filter(rel =>
    readFileSync(join(REPO_ROOT, rel)).includes(0)
  )
  expect(offenders).toEqual([])
})

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
    'lib/services/policy/policy-compiler.service.ts',
    '__tests__/ee/security/policy-compiler.service.test.ts',
  ]) {
    const src = readFileSync(join(REPO_ROOT, rel), 'utf8')
    expect(src).toContain(`${NUL_ESCAPE}compiler:`)
    expect(src).not.toContain(NUL)
  }
})
