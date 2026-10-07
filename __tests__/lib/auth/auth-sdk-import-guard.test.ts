/**
 * @jest-environment node
 */
// LUM-1026 regression guard: the auth provider SDK (@clerk/*) may only be
// imported from lib/auth/. Everything else goes through the @/lib/auth
// interface so the provider can be swapped (Better Auth, LUM-1027).
import fs from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '../../..')
const SCANNED_DIRS = ['app', 'lib', 'components', 'hooks', 'shared']
const SCANNED_FILES = ['proxy.ts']
const ALLOWED_PREFIX = path.join('lib', 'auth') + path.sep
// Any quoted '@clerk/<pkg>[/sub]' module specifier counts, wherever it sits:
// `from`, `import()`, `require()`, a side-effect `import '...'`, or
// a multi-line import whose `from` clause is lines away. Unquoted prose is
// ignored.
const IMPORT_RE = /['"]@clerk\/[^'"\s]+['"]/

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

/** Pure: repo-relative paths of files that import an auth SDK. */
function findOffendingImports(files: Array<[string, string]>): string[] {
  return files
    .filter(([rel]) => !rel.startsWith(ALLOWED_PREFIX))
    .filter(([, src]) => IMPORT_RE.test(src))
    .map(([rel]) => rel)
}

describe('@clerk/* import guard (LUM-1026)', () => {
  it('detects static, dynamic, subpath, multi-line, re-export and side-effect imports but ignores prose', () => {
    const fixtures: Array<[string, string]> = [
      ['app/a.tsx', "import { SignIn } from '@clerk/nextjs'"],
      ['lib/b.ts', "const m = await import('@clerk/nextjs/server')"],
      ['lib/c.ts', 'const m = require("@clerk/mcp-tools/next")'],
      ['lib/d.ts', "export { auth } from '@clerk/nextjs/server'"],
      ['lib/e.ts', '// we used to call @clerk/nextjs directly'],
      [
        'components/f.tsx',
        "import {\n  useUser,\n  useClerk,\n} from\n  '@clerk/nextjs'",
      ],
      ['proxy.ts', "import '@clerk/nextjs/server'"],
      ['hooks/g.ts', "import type { User } from '@clerk/backend'"],
      [
        path.join('lib', 'auth', 'clerk', 'session.ts'),
        "import { auth } from '@clerk/nextjs/server'",
      ],
      // A sibling folder whose name merely starts with "auth" is not exempt.
      [
        path.join('lib', 'authz', 'x.ts'),
        "import { auth } from '@clerk/nextjs/server'",
      ],
    ]
    expect(findOffendingImports(fixtures)).toEqual([
      'app/a.tsx',
      'lib/b.ts',
      'lib/c.ts',
      'lib/d.ts',
      'components/f.tsx',
      'proxy.ts',
      'hooks/g.ts',
      path.join('lib', 'authz', 'x.ts'),
    ])
  })

  it('no file outside lib/auth imports @clerk/*', () => {
    const files = [
      ...SCANNED_DIRS.flatMap(d => listSourceFiles(path.join(ROOT, d))),
      ...SCANNED_FILES.map(f => path.join(ROOT, f)).filter(fs.existsSync),
    ]
    expect(files.length).toBeGreaterThan(100)
    const pairs = files.map(
      f =>
        [path.relative(ROOT, f), fs.readFileSync(f, 'utf8')] as [string, string]
    )
    expect(findOffendingImports(pairs)).toEqual([])
  })

  it('lib/auth is where the Clerk implementation lives', () => {
    const files = listSourceFiles(path.join(ROOT, 'lib', 'auth'))
    const importers = files
      .filter(f => IMPORT_RE.test(fs.readFileSync(f, 'utf8')))
      .map(f => path.relative(ROOT, f))
    expect(importers).toEqual(
      expect.arrayContaining([
        path.join('lib', 'auth', 'clerk', 'session.ts'),
        path.join('lib', 'auth', 'clerk', 'users.ts'),
        path.join('lib', 'auth', 'clerk', 'client.tsx'),
        path.join('lib', 'auth', 'clerk', 'middleware.ts'),
        path.join('lib', 'auth', 'clerk', 'mcp.ts'),
        path.join('lib', 'auth', 'clerk', 'oauth-metadata.ts'),
        path.join('lib', 'auth', 'clerk-webhook.ts'),
      ])
    )
  })
})
