import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import type { OsvVuln } from './osv-advisory'

/**
 * `lumo security scan --deps --full` / `--offline`: osv-scanner from PATH,
 * never downloaded. `scan source --format json` keeps the OSV records and
 * the grouping (`groups[].ids`, `max_severity`) osv-scanner's own SARIF is
 * built from, so a finding here has the managed scan's id and fingerprint.
 * osv-scanner applies `osv-scanner.toml` itself.
 */

export const OSV_SCANNER_BIN = 'osv-scanner'

/** Exit codes osv-scanner v2 documents: 0 clean, 1 vulnerabilities found, 128 no packages found. */
const EXIT_FOUND = 1
const EXIT_NO_PACKAGES = 128

export const OSV_SCANNER_INSTALL_HINT = [
  `${OSV_SCANNER_BIN} is not on PATH — --full and --offline run it locally, and Lumo never downloads it. Install it, then re-run:`,
  '  brew install osv-scanner',
  '  go install github.com/google/osv-scanner/v2/cmd/osv-scanner@latest',
  '  or a release binary from https://github.com/google/osv-scanner/releases',
].join('\n')

export const OSV_OFFLINE_DB_HINT =
  'osv-scanner has no local vulnerability database for --offline. Fetch it once (this downloads the OSV database, not a binary): osv-scanner scan source --offline-vulnerabilities --download-offline-databases -r .'

/** Absolute path of `bin` on PATH, or null. */
export function findOnPath(
  bin: string,
  envPath: string | undefined = process.env.PATH
): string | null {
  const exts =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';')
      : ['']
  for (const dir of (envPath ?? '').split(path.delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const candidate = path.join(dir, bin + ext)
      try {
        fs.accessSync(candidate, fs.constants.X_OK)
        if (fs.statSync(candidate).isFile()) return candidate
      } catch {
        // not here
      }
    }
  }
  return null
}

/** One vulnerable package from osv-scanner's JSON, one entry per advisory group. */
export interface ScannerPackage {
  /** Lockfile, repo-relative. */
  filePath: string
  ecosystem: string
  name: string
  version: string
  groups: { ids: string[]; maxScore: number | null; vulns: OsvVuln[] }[]
}

function rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

/** A source path osv-scanner printed (absolute, sometimes `file://`) → repo-relative. */
export function relativeSource(p: string, root: string): string {
  let s = p.replace(/^file:\/\//i, '')
  if (path.isAbsolute(s)) s = path.relative(root, s)
  return s.split(path.sep).join('/').replace(/^\.\//, '')
}

/** osv-scanner `--format json` → vulnerable packages. Throws on a document that is not its shape. */
export function parseScannerJson(doc: unknown, root: string): ScannerPackage[] {
  const d = rec(doc)
  if (!d)
    throw new Error('osv-scanner printed something that is not its JSON report')
  const out: ScannerPackage[] = []
  for (const r of arr(d['results'])) {
    const result = rec(r)
    const source = str(rec(result?.['source'])?.['path'])
    if (!source) continue
    const filePath = relativeSource(source, root)
    for (const p of arr(result?.['packages'])) {
      const entry = rec(p)
      const pkg = rec(entry?.['package'])
      const name = str(pkg?.['name'])
      const version = str(pkg?.['version'])
      if (!name || !version) continue
      const vulns = arr(entry?.['vulnerabilities'])
        .map(v => rec(v) as OsvVuln | null)
        .filter((v): v is OsvVuln => !!v && typeof v.id === 'string')
      const groups = arr(entry?.['groups'])
        .map(g => {
          const ids = arr(rec(g)?.['ids']).filter(
            (id): id is string => typeof id === 'string' && id.length > 0
          )
          const sev = Number(str(rec(g)?.['max_severity']) ?? NaN)
          return {
            ids,
            maxScore: Number.isFinite(sev) ? sev : null,
            vulns: vulns.filter(v => ids.includes(v.id)),
          }
        })
        .filter(g => g.ids.length > 0)
      // A report without groups: one group per advisory.
      const effective =
        groups.length > 0
          ? groups
          : vulns.map(v => ({ ids: [v.id], maxScore: null, vulns: [v] }))
      if (effective.length === 0) continue
      out.push({
        filePath,
        ecosystem: str(pkg?.['ecosystem']) ?? 'unknown',
        name,
        version,
        groups: effective,
      })
    }
  }
  return out
}

export interface ScannerRunOptions {
  root: string
  offline: boolean
  /** Lockfiles to scan (repo-relative); omitted = the whole tree (`-r .`). */
  lockfiles?: string[]
  bin?: string | undefined
}

/**
 * Run osv-scanner and parse its report. Throws an actionable error when the
 * binary is missing, the offline database is absent, or the run fails.
 */
export function runOsvScanner(opts: ScannerRunOptions): ScannerPackage[] {
  const bin = opts.bin ?? findOnPath(OSV_SCANNER_BIN)
  if (!bin) throw new Error(OSV_SCANNER_INSTALL_HINT)
  const args = ['scan', 'source', '--format', 'json']
  if (opts.offline) args.push('--offline')
  if (opts.lockfiles) {
    for (const l of opts.lockfiles) args.push('--lockfile', l)
  } else {
    args.push('-r', '.')
  }
  const r = spawnSync(bin, args, {
    cwd: opts.root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: 600_000,
  })
  if (r.error) {
    if ((r.error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(OSV_SCANNER_INSTALL_HINT)
    }
    throw r.error
  }
  if (r.status === EXIT_NO_PACKAGES) return []
  if (r.status !== 0 && r.status !== EXIT_FOUND) {
    const stderr = (r.stderr || '').trim()
    if (opts.offline && /offline|local db|database/i.test(stderr)) {
      throw new Error(`${OSV_OFFLINE_DB_HINT}\n${stderr.slice(-500)}`)
    }
    throw new Error(
      `osv-scanner failed (exit ${r.status ?? 'signal'}): ${stderr.slice(-500) || 'no output'}`
    )
  }
  let doc: unknown
  try {
    doc = JSON.parse(r.stdout || '{}')
  } catch {
    throw new Error('osv-scanner printed something that is not its JSON report')
  }
  return parseScannerJson(doc, opts.root)
}
