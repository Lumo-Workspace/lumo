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
 * so this file guards the invariant (no literal NUL). The byte identity of
 * the policy compiler's escaped separator is pinned with the security
 * plugin, __tests__/ee/security/no-literal-nul-policy-compiler.test.ts
 * (LUM-1065).
 */
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'

const REPO_ROOT = join(__dirname, '..')
const NUL = String.fromCharCode(0)

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
