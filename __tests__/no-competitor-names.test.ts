/**
 * LUM-1145 — no competitor names in Lumo's own artifacts (CLI help, skill
 * docs, code comments that ship in the npm package or the OSS export).
 * Describe the behaviour instead ("auto-review filters", "file cap",
 * "industry-standard default").
 *
 * The only places a name may appear:
 *   - components/landing/**  the deliberate comparison section (LUM-827)
 *   - prisma/migrations/**   applied migrations are immutable
 *
 * The names are assembled from parts so this file does not trip itself.
 */
import { execFileSync } from 'child_process'
import { join } from 'path'

const REPO_ROOT = join(__dirname, '..')

/** Each name split in two, so the literal never appears in this file. */
const COMPETITOR_NAME_PARTS: ReadonlyArray<readonly [string, string]> = [
  ['code', 'rabbit'],
]

const ALLOWLIST_PREFIXES: readonly string[] = [
  'components/landing/',
  'prisma/migrations/',
]

function competitorNamePattern(): RegExp {
  return new RegExp(COMPETITOR_NAME_PARTS.map(p => p.join('')).join('|'), 'i')
}

function isAllowlisted(path: string): boolean {
  return ALLOWLIST_PREFIXES.some(prefix => path.startsWith(prefix))
}

/** Paths (repo-relative) whose content names a competitor, minus the allowlist. */
function offendingPaths(
  files: ReadonlyArray<{ path: string; content: string }>
): string[] {
  const pattern = competitorNamePattern()
  return files
    .filter(f => !isAllowlisted(f.path) && pattern.test(f.content))
    .map(f => f.path)
}

/** Tracked files (working-tree content) that name a competitor. */
function trackedFilesNamingACompetitor(): string[] {
  const names = COMPETITOR_NAME_PARTS.map(p => p.join(''))
  const args = ['grep', '-l', '-i', '-I', '-z']
  for (const n of names) args.push('-e', n)
  try {
    const out = execFileSync('git', args, {
      cwd: REPO_ROOT,
      maxBuffer: 64 * 1024 * 1024,
    })
    return out.toString('utf8').split('\0').filter(Boolean)
  } catch (err) {
    // git grep exits 1 when nothing matches.
    if ((err as { status?: number }).status === 1) return []
    throw err
  }
}

describe('LUM-1145 — no competitor names outside the allowlist', () => {
  it('no tracked file names a competitor outside components/landing and prisma/migrations', () => {
    const hits = trackedFilesNamingACompetitor()
    // Guard the guard: the landing comparison section must still be found,
    // or a broken `git grep` would pass vacuously.
    expect(hits.some(isAllowlisted)).toBe(true)
    expect(hits.filter(p => !isAllowlisted(p))).toEqual([])
  })

  it('flags an injected name outside the allowlist, case-insensitively', () => {
    const injected = ['Code', 'Rabbit'].join('')
    expect(
      offendingPaths([
        { path: 'cli/src/index.ts', content: `// like ${injected}'s limit` },
        { path: 'lib/x.ts', content: `// ${injected.toUpperCase()}` },
        { path: 'lib/clean.ts', content: '// an industry-standard file cap' },
      ])
    ).toEqual(['cli/src/index.ts', 'lib/x.ts'])
  })

  it('lets the name through only under the allowlisted prefixes', () => {
    const injected = ['code', 'rabbit'].join('')
    expect(
      offendingPaths([
        { path: 'components/landing/home/compare.tsx', content: injected },
        { path: 'prisma/migrations/2026_x/migration.sql', content: injected },
        { path: 'components/landing-other.tsx', content: injected },
        { path: 'docs/prisma/migrations.md', content: injected },
      ])
    ).toEqual(['components/landing-other.tsx', 'docs/prisma/migrations.md'])
    expect(isAllowlisted('components/landing/home/home.module.css')).toBe(true)
    expect(isAllowlisted('lib/landing/x.ts')).toBe(false)
  })
})
