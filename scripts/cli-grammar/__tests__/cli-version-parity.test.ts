/**
 * @jest-environment node
 *
 * LUM-1104: the CLI version lives in three committed places — cli/package.json
 * (what npm publishes), the root package-lock.json workspace entry (`cli`),
 * and grammar.json's `cliVersion`. grammar-drift.test.ts deliberately ignores
 * `cliVersion`, so a bump that touched only cli/package.json (#1405) left the
 * other two stale with every test green. This suite pins the three together:
 * a CLI bump must also refresh the lockfile (`npm install --package-lock-only`)
 * and grammar.json (`npx tsx scripts/cli-grammar/emit-grammar.ts`).
 */
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..', '..', '..')

const readJson = (rel: string): unknown =>
  JSON.parse(readFileSync(join(ROOT, rel), 'utf8'))

interface CliVersionSources {
  packageJson: unknown
  packageLock: unknown
  grammar: unknown
}

/** The CLI version as each source records it (`undefined` = not found). */
function cliVersions(src: CliVersionSources): Record<string, unknown> {
  const pkg = src.packageJson as { version?: unknown } | null
  const lock = src.packageLock as {
    packages?: Record<string, { version?: unknown }>
  } | null
  const grammar = src.grammar as { cliVersion?: unknown } | null
  return {
    'cli/package.json': pkg?.version,
    'package-lock.json packages.cli': lock?.packages?.['cli']?.version,
    'scripts/cli-grammar/grammar.json cliVersion': grammar?.cliVersion,
  }
}

/** Human-readable mismatch report; empty when all three agree. */
function cliVersionMismatch(src: CliVersionSources): string[] {
  const versions = cliVersions(src)
  const expected = versions['cli/package.json']
  if (typeof expected !== 'string' || !expected) {
    return ['cli/package.json has no version']
  }
  return Object.entries(versions)
    .filter(([, v]) => v !== expected)
    .map(([where, v]) => `${where} = ${String(v)} (expected ${expected})`)
}

describe('CLI version parity (LUM-1104)', () => {
  it('cli/package.json, package-lock.json and grammar.json agree', () => {
    const mismatch = cliVersionMismatch({
      packageJson: readJson('cli/package.json'),
      packageLock: readJson('package-lock.json'),
      grammar: readJson('scripts/cli-grammar/grammar.json'),
    })
    expect(mismatch).toEqual([])
  })

  it('reports each source that lags behind cli/package.json', () => {
    expect(
      cliVersionMismatch({
        packageJson: { version: '1.2.0' },
        packageLock: { packages: { cli: { version: '1.1.0' } } },
        grammar: { cliVersion: '1.1.0' },
      })
    ).toEqual([
      'package-lock.json packages.cli = 1.1.0 (expected 1.2.0)',
      'scripts/cli-grammar/grammar.json cliVersion = 1.1.0 (expected 1.2.0)',
    ])
  })

  it('treats a missing lockfile entry as a mismatch, not a pass', () => {
    expect(
      cliVersionMismatch({
        packageJson: { version: '1.2.0' },
        packageLock: { packages: {} },
        grammar: { cliVersion: '1.2.0' },
      })
    ).toEqual(['package-lock.json packages.cli = undefined (expected 1.2.0)'])
    expect(
      cliVersionMismatch({
        packageJson: {},
        packageLock: {},
        grammar: {},
      })
    ).toEqual(['cli/package.json has no version'])
  })

  it('agrees when all three match', () => {
    expect(
      cliVersionMismatch({
        packageJson: { version: '1.2.0' },
        packageLock: { packages: { cli: { version: '1.2.0' } } },
        grammar: { cliVersion: '1.2.0' },
      })
    ).toEqual([])
  })
})
