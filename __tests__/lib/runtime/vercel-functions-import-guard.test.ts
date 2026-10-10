/**
 * @jest-environment node
 */
// LUM-1022 regression guard: @vercel/functions may only be imported from
// lib/runtime/. Everything else goes through @/lib/runtime/wait-until so the
// app keeps working when self-hosted on plain Node.
import fs from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '../../..')
// LUM-1065: ee/ is the security plugin tree (absent from the OSS snapshot).
const SCANNED_DIRS = ['app', 'lib', 'components', 'shared', 'ee']
const ALLOWED_PREFIX = path.join('lib', 'runtime') + path.sep
// Any quoted '@vercel/functions[/sub]' module specifier counts, wherever it
// sits: `from`, `import()`, `require()`, a side-effect `import '...'`, or a
// multi-line import whose `from` clause is lines away. Unquoted prose is ignored.
const IMPORT_RE = /['"]@vercel\/functions(?:\/[^'"\s]*)?['"]/

function listSourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listSourceFiles(full))
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) out.push(full)
  }
  return out
}

/** Pure: repo-relative paths of files that import @vercel/functions. */
function findOffendingImports(files: Array<[string, string]>): string[] {
  return files
    .filter(([rel]) => !rel.startsWith(ALLOWED_PREFIX))
    .filter(([, src]) => IMPORT_RE.test(src))
    .map(([rel]) => rel)
}

describe('@vercel/functions import guard (LUM-1022)', () => {
  it('detects static, dynamic, subpath, multi-line and side-effect imports but ignores prose', () => {
    const fixtures: Array<[string, string]> = [
      ['app/a.ts', "import { waitUntil } from '@vercel/functions'"],
      ['lib/b.ts', "const m = await import('@vercel/functions/oidc')"],
      ['lib/c.ts', 'const m = require("@vercel/functions")'],
      ['lib/d.ts', "export { waitUntil } from '@vercel/functions'"],
      ['lib/e.ts', '// we used to call @vercel/functions directly'],
      [
        'lib/f.ts',
        "import {\n  waitUntil,\n  geolocation,\n} from\n  '@vercel/functions'",
      ],
      ['lib/g.ts', "import '@vercel/functions'"],
      [
        path.join('lib', 'runtime', 'wait-until.ts'),
        "import { waitUntil } from '@vercel/functions'",
      ],
    ]
    expect(findOffendingImports(fixtures)).toEqual([
      'app/a.ts',
      'lib/b.ts',
      'lib/c.ts',
      'lib/d.ts',
      'lib/f.ts',
      'lib/g.ts',
    ])
  })

  it('no file outside lib/runtime imports @vercel/functions', () => {
    const files = SCANNED_DIRS.flatMap(d => listSourceFiles(path.join(ROOT, d)))
    expect(files.length).toBeGreaterThan(100)
    const pairs = files.map(
      f =>
        [path.relative(ROOT, f), fs.readFileSync(f, 'utf8')] as [string, string]
    )
    expect(findOffendingImports(pairs)).toEqual([])
  })

  it('the wrapper itself is the one place that does', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'lib', 'runtime', 'wait-until.ts'),
      'utf8'
    )
    expect(IMPORT_RE.test(src)).toBe(true)
  })
})
