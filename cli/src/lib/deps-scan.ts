import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { GIT_OUTPUT_MAX_BYTES, type ScanBase } from './local-diff'
import { lockfileDelta, NPM_LOCKFILES, type NpmPackage } from './npm-lockfile'
import {
  groupVulns,
  toDependencyFinding,
  type DependencyFinding,
  type IgnoredAdvisory,
  type OsvVuln,
} from './osv-advisory'
import { fetchVulns, OsvUnavailableError, queryBatch } from './osv-api'
import { parseOsvIgnores, type OsvIgnore } from './osv-ignores'
import { runOsvScanner, type ScannerPackage } from './osv-scanner-run'

/**
 * The `DEPS` scanner of `lumo security scan`.
 *
 * - fast (default): the npm lockfiles the scope changed, diffed base → head;
 *   only added / re-versioned packages are looked up on api.osv.dev. No
 *   binary.
 * - `full`: osv-scanner over the whole tree, as the managed scan runs it.
 * - `offline`: osv-scanner's local database instead of the API (fast mode
 *   then runs it on the changed lockfiles and keeps the changed packages;
 *   without osv-scanner or its database the result is incomplete).
 *
 * An unreachable API makes the result `incomplete` — never clean.
 */

export interface DepsScanOptions {
  full: boolean
  offline: boolean
  now?: Date | undefined
  fetchImpl?: typeof fetch | undefined
  /** osv-scanner binary; default: looked up on PATH. */
  scannerBin?: string | undefined
  /** LUM-1258 — `--timeout`: the whole api.osv.dev lookup's budget (ms). */
  timeoutMs?: number | undefined
}

export interface DepsScanResult {
  mode: 'fast' | 'full'
  /** Where advisories came from. */
  source: 'api.osv.dev' | 'osv-scanner' | 'osv-scanner (offline)'
  /** Lockfiles read: the changed npm ones (fast), or those osv-scanner reported on (full). */
  lockfiles: string[]
  /** Fast mode: added / re-versioned packages looked up. Null in full mode. */
  packagesChecked: number | null
  findings: DependencyFinding[]
  ignored: IgnoredAdvisory[]
  /** Fast mode: changed lockfiles of ecosystems it does not read (use --full). */
  notCovered: string[]
  /** Why the result is not the full answer; null when it is. */
  incomplete: string | null
}

/** Lockfiles of the ecosystems fast mode does not read — a change to one is reported as not covered. */
const OTHER_LOCKFILES =
  /^(yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|requirements[^/]*\.txt|poetry\.lock|pdm\.lock|uv\.lock|pipfile\.lock|go\.mod|cargo\.lock|gemfile\.lock|composer\.lock|gradle\.lockfile|pom\.xml|packages\.lock\.json|pubspec\.lock|mix\.lock|conan\.lock|renv\.lock|podfile\.lock|package\.resolved)$/i

function git(root: string, args: string[]): { ok: boolean; out: string } {
  const r = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: GIT_OUTPUT_MAX_BYTES,
    timeout: 120_000,
  })
  if (r.error) throw r.error
  return { ok: r.status === 0, out: r.stdout ?? '' }
}

/** A file at a revision (`<rev>:<path>`, or `:<path>` for the index); null when absent there. */
function showAt(root: string, rev: string, rel: string): string | null {
  // `--` ends the revisions, as in local-diff.ts.
  const r = git(root, ['show', `${rev}:${rel}`, '--'])
  return r.ok ? r.out : null
}

/** Lockfiles present at head, repo-relative. */
function headLockfiles(root: string, scope: ScanBase): string[] {
  const args =
    scope.head === 'index'
      ? ['-c', 'core.quotePath=false', 'ls-files', '-z']
      : scope.head === 'commit'
        ? // LUM-1258 `--until`: the files of that commit, not the working tree.
          [
            '-c',
            'core.quotePath=false',
            'ls-tree',
            '-r',
            '--name-only',
            '-z',
            scope.until!,
          ]
        : [
            '-c',
            'core.quotePath=false',
            'ls-files',
            '-co',
            '--exclude-standard',
            '-z',
          ]
  const r = git(root, args)
  if (!r.ok) throw new Error('git ls-files failed')
  return r.out
    .split('\0')
    .filter(Boolean)
    .filter(rel => !rel.split('/').includes('node_modules'))
    .filter(rel => {
      const base = rel.slice(rel.lastIndexOf('/') + 1)
      return NPM_LOCKFILES.includes(base) || OTHER_LOCKFILES.test(base)
    })
}

function readHead(root: string, scope: ScanBase, rel: string): string | null {
  if (scope.head === 'index') return showAt(root, '', rel)
  if (scope.head === 'commit') return showAt(root, scope.until!, rel)
  try {
    return fs.readFileSync(path.join(root, rel), 'utf8')
  } catch {
    return null
  }
}

/** The `osv-scanner.toml` next to a lockfile (osv-scanner's own lookup; it does not apply to subdirectories). */
function ignoresLoader(root: string): (lockfile: string) => OsvIgnore[] {
  const cache = new Map<string, OsvIgnore[]>()
  return lockfile => {
    const dir = path.posix.dirname(lockfile)
    let hit = cache.get(dir)
    if (!hit) {
      try {
        hit = parseOsvIgnores(
          fs.readFileSync(path.join(root, dir, 'osv-scanner.toml'), 'utf8')
        )
      } catch {
        hit = []
      }
      cache.set(dir, hit)
    }
    return hit
  }
}

interface Collected {
  findings: DependencyFinding[]
  ignored: IgnoredAdvisory[]
}

function collect(
  pkgs: ScannerPackage[],
  ignoresFor: (lockfile: string) => OsvIgnore[],
  now: Date
): Collected {
  const out: Collected = { findings: [], ignored: [] }
  const seen = new Set<string>()
  for (const p of pkgs) {
    for (const g of p.groups) {
      const r = toDependencyFinding(
        {
          ecosystem: p.ecosystem,
          name: p.name,
          version: p.version,
          filePath: p.filePath,
          ids: g.ids,
          vulns: g.vulns,
          maxScore: g.maxScore,
        },
        ignoresFor(p.filePath),
        now
      )
      if ('ignored' in r) {
        out.ignored.push(r.ignored)
        continue
      }
      // The managed scan keeps one row per rule + fingerprint.
      const key = `${r.finding.ruleId}:${r.finding.fingerprint}`
      if (seen.has(key)) continue
      seen.add(key)
      out.findings.push(r.finding)
    }
  }
  return out
}

/** Fast mode's API path: delta packages → OSV ids → records → grouped per package. */
async function lookUp(
  changed: { lockfile: string; packages: NpmPackage[] }[],
  fetchImpl: typeof fetch | undefined,
  timeoutMs: number | undefined
): Promise<ScannerPackage[]> {
  const deadline = timeoutMs === undefined ? undefined : Date.now() + timeoutMs
  const queries = new Map<string, NpmPackage>()
  for (const c of changed) {
    for (const p of c.packages) queries.set(`${p.name}@${p.version}`, p)
  }
  const list = [...queries.values()]
  if (list.length === 0) return []
  const ids = await queryBatch(
    list.map(p => ({ ecosystem: 'npm', name: p.name, version: p.version })),
    fetchImpl,
    deadline
  )
  const idsByKey = new Map<string, string[]>()
  list.forEach((p, i) => idsByKey.set(`${p.name}@${p.version}`, ids[i] ?? []))
  const records = await fetchVulns(ids.flat(), fetchImpl, deadline)
  const out: ScannerPackage[] = []
  for (const c of changed) {
    for (const p of c.packages) {
      const vulns = (idsByKey.get(`${p.name}@${p.version}`) ?? [])
        .map(id => records.get(id))
        .filter((v): v is OsvVuln => !!v)
      if (vulns.length === 0) continue
      out.push({
        filePath: c.lockfile,
        ecosystem: 'npm',
        name: p.name,
        version: p.version,
        groups: groupVulns(vulns).map(g => ({ ...g, maxScore: null })),
      })
    }
  }
  return out
}

export async function scanDeps(
  scope: ScanBase,
  opts: DepsScanOptions
): Promise<DepsScanResult> {
  const now = opts.now ?? new Date()
  const { root } = scope
  const ignoresFor = ignoresLoader(root)
  const source = opts.offline
    ? ('osv-scanner (offline)' as const)
    : opts.full
      ? ('osv-scanner' as const)
      : ('api.osv.dev' as const)

  if (opts.full) {
    const pkgs = runOsvScanner({
      root,
      offline: opts.offline,
      bin: opts.scannerBin,
    })
    const { findings, ignored } = collect(pkgs, ignoresFor, now)
    return {
      mode: 'full',
      source,
      lockfiles: [...new Set(pkgs.map(p => p.filePath))].sort(),
      packagesChecked: null,
      findings,
      ignored,
      notCovered: [],
      incomplete: null,
    }
  }

  const changed: { lockfile: string; packages: NpmPackage[] }[] = []
  const notCovered: string[] = []
  const unreadable: string[] = []
  for (const rel of headLockfiles(root, scope)) {
    const head = readHead(root, scope, rel)
    if (head === null) continue
    const base = showAt(root, scope.base, rel)
    if (base === head) continue
    const name = rel.slice(rel.lastIndexOf('/') + 1)
    if (!NPM_LOCKFILES.includes(name)) {
      notCovered.push(rel)
      continue
    }
    try {
      changed.push({ lockfile: rel, packages: lockfileDelta(base, head) })
    } catch {
      unreadable.push(rel)
    }
  }
  const result: DepsScanResult = {
    mode: 'fast',
    source,
    lockfiles: changed.map(c => c.lockfile),
    packagesChecked: new Set(
      changed.flatMap(c => c.packages.map(p => `${p.name}@${p.version}`))
    ).size,
    findings: [],
    ignored: [],
    notCovered,
    incomplete:
      unreadable.length > 0
        ? `not valid JSON, not checked: ${unreadable.join(', ')}`
        : null,
  }
  if (result.packagesChecked === 0) return result

  let pkgs: ScannerPackage[]
  if (opts.offline) {
    const wanted = new Set(
      changed.flatMap(c =>
        c.packages.map(p => `${c.lockfile}\0${p.name}@${p.version}`)
      )
    )
    try {
      pkgs = runOsvScanner({
        root,
        offline: true,
        lockfiles: changed
          .filter(c => c.packages.length > 0)
          .map(c => c.lockfile),
        bin: opts.scannerBin,
      }).filter(p => wanted.has(`${p.filePath}\0${p.name}@${p.version}`))
    } catch (e) {
      // `--offline` also serves the other scanners (a pre-commit hook that
      // must not wait on the network): a missing binary or database leaves
      // DEPS unknown rather than failing the whole scan.
      const first = ((e as Error)?.message ?? '').split('\n')[0]
      const why = `--offline: ${first}; dependency results are unknown, not clean`
      return {
        ...result,
        incomplete: result.incomplete ? `${result.incomplete}; ${why}` : why,
      }
    }
  } else {
    try {
      pkgs = await lookUp(changed, opts.fetchImpl, opts.timeoutMs)
    } catch (e) {
      if (!(e instanceof OsvUnavailableError)) throw e
      const why = `${e.message}; dependency results are unknown, not clean — retry, or use --offline / --full`
      return {
        ...result,
        incomplete: result.incomplete ? `${result.incomplete}; ${why}` : why,
      }
    }
  }
  const { findings, ignored } = collect(pkgs, ignoresFor, now)
  return { ...result, findings, ignored }
}
