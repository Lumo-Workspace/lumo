import { scanSecrets } from '../../../shared/src/secret-scan/scan-secrets'
import { scanDeps, type DepsScanResult } from '../lib/deps-scan'
import { EXIT_USAGE } from '../lib/exit-codes'
import { emitJson } from '../lib/json-output'
import {
  collectLocalDiff,
  resolveScanBase,
  type ScanScope,
} from '../lib/local-diff'
import { WARN_PREFIX } from '../lib/errors'
import {
  EXIT_FAIL_ON,
  FAIL_ON_VALUES,
  formatLocalScan,
  incompleteScanners,
  localScanJson,
  meetsFailOn,
  parseFailOn,
  type LocalFinding,
  type FailOn,
  type LocalScanner,
  type LocalScanResult,
  type PrSection,
  type ServerSection,
} from '../lib/local-scan-report'
import {
  detectBranch,
  detectRepo,
  loadPrScan,
  loadScanContext,
  originUrl,
  type ScanContextDeps,
} from '../lib/scan-context'
import { comparePrFindings, labelFinding } from '../lib/scan-labels'
import { colorEnabled, terminalWidth } from '../lib/ui'
import { readCliVersion } from '../lib/cli-version'
import {
  buildRunPayload,
  commitFacts,
  commitsInRange,
  isMergeCommit,
  resolveCommit,
  uploadRuns,
  type LocalRunPayload,
  type LogTrigger,
  type UploadDeps,
} from '../lib/local-scan-log'
import { detectDefaultBranch, gitOutput } from '../lib/worktree'
import type { LogSection } from '../lib/local-scan-report'

export interface SecurityScanOptions {
  secrets?: boolean
  deps?: boolean
  /** DEPS: run osv-scanner over the whole tree instead of the lockfile delta. */
  full?: boolean
  staged?: boolean
  since?: string
  /** LUM-1258 — end the diff at this commit instead of the working tree. */
  until?: string
  json?: boolean
  failOn?: string
  /**
   * Make no network call: the server context comes from the cache only
   * (LUM-1256) and DEPS uses osv-scanner's local database (LUM-1257).
   */
  offline?: boolean
  /** LUM-1256 — merge in the branch's open PR's server findings. */
  pr?: boolean
  /** LUM-1256 — `owner/name` instead of origin's. */
  repo?: string
  /** LUM-1258 — seconds to wait for the network (Lumo server, api.osv.dev). */
  timeout?: string
  /** LUM-1259 — scan one commit against its first parent. */
  commit?: string
  /** LUM-1259 — record each scanned commit's result on the server. */
  log?: boolean
  /** LUM-1259 — hidden: the git hook that runs `--log` (post-commit | pre-push). */
  hook?: string
}

/** LUM-1259 — `--hook` values → the trigger a logged run records. */
const HOOK_TRIGGERS: ReadonlyMap<string, LogTrigger> = new Map([
  ['post-commit', 'POST_COMMIT'],
  ['pre-push', 'PRE_PUSH'],
])

/** `--timeout` bounds: a hook wants seconds, nobody wants minutes. */
const TIMEOUT_MAX_SECONDS = 60

/**
 * Seconds as given to `--timeout` → ms, rounded up so any value above 0 waits
 * at least 1 ms; null when not a number in (0, 60].
 */
export function parseTimeoutSeconds(value: string): number | null {
  if (!/^\d+(\.\d+)?$/.test(value.trim())) return null
  const n = Number(value)
  return n > 0 && n <= TIMEOUT_MAX_SECONDS ? Math.ceil(n * 1000) : null
}

/** The scanners a run selects: the flags given, or every local scanner. */
export function selectScanners(opts: SecurityScanOptions): LocalScanner[] {
  const picked: LocalScanner[] = []
  if (opts.secrets) picked.push('SECRETS')
  if (opts.deps) picked.push('DEPS')
  return picked.length > 0 ? picked : ['SECRETS', 'DEPS']
}

/**
 * Test seams: the server context's (LUM-1256), the DEPS scanner's OSV API
 * and binary (LUM-1257), and (LUM-1259) the log upload, the environment the
 * actor is read from and the clock.
 */
export interface SecurityScanDeps extends ScanContextDeps, UploadDeps {
  fetch?: typeof fetch
  osvFetch?: typeof fetch
  scannerBin?: string
  env?: Record<string, string | undefined>
}

/**
 * LUM-1256 — label the findings with the server context (never fatal: no
 * context is a note, not an error) and, with `--pr`, compare them with the
 * branch's PR's latest server scan. Fixed-vs-open is only meaningful when
 * the scan covers the PR's own diff (the default scope).
 */
export async function withServerContext(
  findings: LocalFinding[],
  input: {
    root: string
    scanners: LocalScanner[]
    scope: ScanScope
    offline: boolean
    pr: boolean
    repo?: string | undefined
    timeoutMs?: number | undefined
  },
  deps: ScanContextDeps = {}
): Promise<{ findings: LocalFinding[]; server: ServerSection }> {
  const repo = input.repo ?? detectRepo(input.root)
  const loaded = await loadScanContext(
    {
      repo,
      branch: detectBranch(input.root),
      offline: input.offline,
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    },
    deps
  )
  const ctx = loaded.context
  const labelled = ctx
    ? findings.map(f => ({ ...f, server: labelFinding(f, ctx) }))
    : findings
  let pr: PrSection | null = null
  if (input.pr) {
    const number = ctx?.pullRequest?.number ?? null
    if (number === null || !loaded.repo) {
      pr = null
    } else if (loaded.source !== 'live') {
      pr = {
        number,
        headSha: null,
        note: 'no live server context',
        comparison: null,
      }
    } else {
      const scan = await loadPrScan(number, loaded.repo, deps, input.timeoutMs)
      if (!scan.ok) {
        pr = { number, headSha: null, note: scan.note, comparison: null }
      } else if (
        input.scope.kind !== 'default' ||
        input.scope.until !== undefined
      ) {
        pr = {
          number,
          headSha: scan.headSha,
          note: 'not compared: --staged / --since / --until do not cover the PR diff',
          comparison: null,
        }
      } else {
        pr = {
          number,
          headSha: scan.headSha,
          note: null,
          comparison: comparePrFindings(
            scan.findings,
            labelled,
            input.scanners
          ),
        }
      }
    }
  }
  return {
    findings: labelled,
    server: {
      source: loaded.source,
      note:
        input.pr && ctx && !ctx.pullRequest
          ? [loaded.note, '--pr: this branch has no open PR']
              .filter(Boolean)
              .join('; ')
          : loaded.note,
      repo: loaded.repo,
      renamedFrom: ctx?.renamedFrom ?? null,
      remoteUrl: input.repo === undefined ? originUrl(input.root) : null,
      fetchedAt: loaded.fetchedAt,
      pullRequest: ctx?.pullRequest?.number ?? null,
      policy: ctx?.policy ?? null,
      pr,
    },
  }
}

/**
 * LUM-1255 — `lumo security scan`: Lumo's scanners over the lines a local
 * diff adds. `SECRETS` is the PR scan's deterministic secret scanner
 * (`shared/src/secret-scan`, the same code stage A runs): no network, no
 * binary, findings carry the server's fingerprints. Read-only: nothing is
 * uploaded. LUM-1256: each finding is labelled with the server context
 * (cached by ETag; `--offline` reads the cache only), `--pr` merges in the
 * branch's PR scan.
 *
 * LUM-1257 — `DEPS`: vulnerable / malicious dependencies with the managed
 * scan's osv-scanner identity (`lib/deps-scan.ts`). Its default fast mode
 * sends changed package names and versions to api.osv.dev; an unanswered
 * lookup makes the scan incomplete (exit 1 unless `--fail-on` is met),
 * never clean.
 */
export async function securityScanCommand(
  opts: SecurityScanOptions,
  deps: SecurityScanDeps = {}
): Promise<number> {
  if (opts.staged && opts.since !== undefined) {
    console.error('Error: pass either --staged or --since <ref>, not both')
    return EXIT_USAGE
  }
  if (opts.staged && opts.until !== undefined) {
    console.error(
      'Error: --until ends a commit range; it cannot run with --staged'
    )
    return EXIT_USAGE
  }
  if (opts.pr && opts.offline) {
    console.error('Error: --pr reads the server; it cannot run with --offline')
    return EXIT_USAGE
  }
  const timeoutMs =
    opts.timeout === undefined ? undefined : parseTimeoutSeconds(opts.timeout)
  if (timeoutMs === null) {
    console.error(
      `Error: invalid --timeout "${opts.timeout}" (seconds, more than 0 and at most ${TIMEOUT_MAX_SECONDS})`
    )
    return EXIT_USAGE
  }
  if (timeoutMs !== undefined && opts.offline) {
    console.error(
      'Error: --timeout bounds the wait for the network; --offline makes no call'
    )
    return EXIT_USAGE
  }
  if (opts.repo !== undefined && !/^[^/\s]+\/[^/\s]+$/.test(opts.repo)) {
    console.error(`Error: invalid --repo "${opts.repo}" (expected owner/name)`)
    return EXIT_USAGE
  }
  const failOn = opts.failOn === undefined ? null : parseFailOn(opts.failOn)
  if (opts.failOn !== undefined && failOn === null) {
    console.error(
      `Error: invalid --fail-on "${opts.failOn}" (allowed: ${FAIL_ON_VALUES.join(', ')})`
    )
    return EXIT_USAGE
  }
  const perCommit = commitModeError(opts)
  if (perCommit) {
    console.error(`Error: ${perCommit}`)
    return EXIT_USAGE
  }
  if (opts.commit !== undefined || opts.log)
    return scanCommits(opts, { failOn, timeoutMs }, deps)

  const until = opts.until !== undefined ? { until: opts.until } : {}
  const scope: ScanScope = opts.staged
    ? { kind: 'staged' }
    : opts.since !== undefined
      ? { kind: 'since', ref: opts.since, ...until }
      : { kind: 'default', ...until }
  const scanners = selectScanners(opts)
  if (opts.full && !scanners.includes('DEPS')) {
    console.error('Error: --full applies to --deps')
    return EXIT_USAGE
  }

  const started = performance.now()
  const base = resolveScanBase(scope)
  const diff = scanners.includes('SECRETS') ? collectLocalDiff(scope) : null
  const depsResult: DepsScanResult | undefined = scanners.includes('DEPS')
    ? await scanDeps(base, {
        full: opts.full === true,
        offline: opts.offline === true,
        fetchImpl: deps.osvFetch,
        scannerBin: deps.scannerBin,
        now: deps.now?.(),
        timeoutMs,
      })
    : undefined
  const scanned: LocalFinding[] = [
    ...(diff
      ? scanSecrets(diff.files).map(f => ({
          ...f,
          scanner: 'SECRETS' as const,
        }))
      : []),
    ...(depsResult?.findings ?? []),
  ]
  const { findings, server } = await withServerContext(
    scanned,
    {
      root: base.root,
      scanners,
      scope,
      offline: opts.offline === true,
      pr: opts.pr === true,
      repo: opts.repo,
      timeoutMs,
    },
    deps
  )
  const result: LocalScanResult = {
    scanners,
    scope: base.description,
    filesScanned: diff?.files.length ?? 0,
    skipped: diff?.skipped ?? [],
    elapsedMs: Math.round(performance.now() - started),
    findings,
    server,
    ...(depsResult ? { deps: depsResult } : {}),
  }

  if (opts.json) emitJson(localScanJson(result))
  else
    console.log(
      formatLocalScan(result, { width: terminalWidth(), color: colorEnabled() })
    )
  // LUM-1258: `done` cannot be judged without the policy — say so, never fail.
  if (failOn === 'DONE' && server.source === 'none' && findings.length > 0)
    console.error(
      `${WARN_PREFIX} --fail-on done: no server context, so no finding can be judged against the workspace policy — not failing`
    )
  if (failOn !== null && meetsFailOn(findings, failOn)) return EXIT_FAIL_ON
  // A scanner that could not finish is a failure, not a clean result.
  return incompleteScanners(result).length > 0 ? 1 : 0
}

/**
 * LUM-1259 — the flag combinations `--commit` / `--log` refuse; null when
 * the run is fine (or uses neither).
 */
export function commitModeError(opts: SecurityScanOptions): string | null {
  if (opts.hook !== undefined && !HOOK_TRIGGERS.has(opts.hook))
    return `invalid --hook "${opts.hook}" (post-commit or pre-push)`
  if (opts.hook !== undefined && !opts.log) return '--hook needs --log'
  if (opts.commit !== undefined) {
    if (opts.staged || opts.since !== undefined || opts.until !== undefined)
      return '--commit scans one commit; it cannot run with --staged, --since or --until'
    if (opts.pr) return '--pr compares the PR diff; it cannot run with --commit'
  }
  if ((opts.commit !== undefined || opts.log) && opts.full)
    return '--full scans the whole tree; it cannot run with --commit or --log'
  if (!opts.log) return null
  if (opts.staged)
    return '--log records commits; staged changes have no sha yet (use --commit <ref> after committing)'
  if (opts.pr) return '--log cannot run with --pr'
  if (opts.commit === undefined && opts.until === undefined)
    return '--log records commits: pass --commit <ref>, or --until <ref> (with --since <ref>) for a range'
  return null
}

/** The commits a per-commit run scans: `--commit`, or the range's non-merges. */
function commitsToScan(
  root: string,
  opts: SecurityScanOptions
): { shas: string[]; skipped: number; range: string } {
  if (opts.commit !== undefined) {
    const sha = resolveCommit(root, opts.commit)
    if (!sha)
      throw new Error(
        `Unknown ref "${opts.commit}" — pass a branch, tag or commit to --commit.`
      )
    if (isMergeCommit(root, sha))
      return { shas: [], skipped: 1, range: `merge commit ${sha.slice(0, 7)}` }
    return { shas: [sha], skipped: 0, range: `commit ${sha.slice(0, 7)}` }
  }
  const until = opts.until as string
  const end = resolveCommit(root, until)
  if (!end)
    throw new Error(
      `Unknown ref "${until}" — pass a branch, tag or commit to --until.`
    )
  let base: string
  if (opts.since !== undefined) {
    const since = resolveCommit(root, opts.since)
    if (!since)
      throw new Error(
        `Unknown ref "${opts.since}" — pass a branch, tag or commit to --since.`
      )
    base = since
  } else {
    const branch = detectDefaultBranch(root, { allowNetwork: false })
    if (!branch)
      throw new Error(
        'Could not find the default branch (no origin/HEAD, origin/main or origin/master). Pass --since <ref>.'
      )
    base = gitOutput(['merge-base', end, `origin/${branch}`], root)
  }
  const { shas, truncated } = commitsInRange(root, base, end)
  return {
    shas,
    skipped: truncated ? 1 : 0,
    range: `${base.slice(0, 7)}..${end.slice(0, 7)} (${shas.length} ${shas.length === 1 ? 'commit' : 'commits'})`,
  }
}

/**
 * LUM-1259 — `--commit <ref>` / `--log`: scan each commit against its first
 * parent (merges are skipped), label the findings with the server context
 * (read once), and with `--log` record one run per commit on the server —
 * or queue it under `.git/lumo` when it cannot go now. The output is the
 * usual report over every scanned commit, each finding naming its commit.
 * Logging never fails the command: a refused or queued upload is a note.
 */
async function scanCommits(
  opts: SecurityScanOptions,
  run: { failOn: FailOn | null; timeoutMs: number | undefined },
  deps: SecurityScanDeps
): Promise<number> {
  const started = performance.now()
  const root = gitOutput(['rev-parse', '--show-toplevel'])
  const scanners = selectScanners(opts)
  const { shas, skipped, range } = commitsToScan(root, opts)

  const branch = detectBranch(root)
  const repo = opts.repo ?? detectRepo(root)
  const loaded = await loadScanContext(
    {
      repo,
      branch,
      offline: opts.offline === true,
      ...(run.timeoutMs !== undefined ? { timeoutMs: run.timeoutMs } : {}),
    },
    deps
  )
  const ctx = loaded.context
  const now = (deps.now ?? (() => new Date()))()
  const cliVersion = readCliVersion()
  const trigger: LogTrigger = HOOK_TRIGGERS.get(opts.hook ?? '') ?? 'MANUAL'
  const label = (f: LocalFinding): LocalFinding =>
    ctx ? { ...f, server: labelFinding(f, ctx) } : f

  const findings: LocalFinding[] = []
  const payloads: LocalRunPayload[] = []
  const depsRuns: DepsScanResult[] = []
  let filesScanned = 0
  let unrecorded = 0
  for (const sha of shas) {
    const scope: ScanScope = { kind: 'commit', ref: sha }
    const diff = scanners.includes('SECRETS')
      ? collectLocalDiff(scope, root)
      : null
    const depsResult = scanners.includes('DEPS')
      ? await scanDeps(resolveScanBase(scope, root), {
          full: false,
          offline: opts.offline === true,
          fetchImpl: deps.osvFetch,
          scannerBin: deps.scannerBin,
          now,
          timeoutMs: run.timeoutMs,
        })
      : undefined
    if (depsResult) depsRuns.push(depsResult)
    filesScanned += diff?.files.length ?? 0
    const found: LocalFinding[] = [
      ...(diff
        ? scanSecrets(diff.files).map(f => ({
            ...f,
            scanner: 'SECRETS' as const,
          }))
        : []),
      ...(depsResult?.findings ?? []),
    ].map(f => label({ ...f, commitSha: sha }))
    findings.push(...found)
    // A scanner that could not finish is not claimed for the commit; with
    // none left there is nothing to record (the server refuses a run that
    // names no scanner, and with it the whole batch).
    const finished = scanners.filter(
      s => s !== 'DEPS' || depsResult?.incomplete == null
    )
    if (opts.log && repo && finished.length === 0) unrecorded++
    else if (opts.log && repo)
      payloads.push(
        buildRunPayload({
          repo,
          facts: commitFacts(root, sha),
          branch,
          trigger,
          scanners: finished,
          cliVersion,
          filesScanned: diff?.files.length ?? 0,
          scannedAt: now,
          findings: found,
          ...(deps.env ? { env: deps.env } : {}),
        })
      )
  }

  let log: LogSection | undefined
  if (opts.log) {
    if (!repo) {
      log = {
        commits: shas,
        skipped,
        unrecorded,
        sent: 0,
        created: 0,
        duplicates: 0,
        queued: 0,
        flushed: 0,
        note: 'no GitHub origin remote (pass --repo owner/name) — nothing recorded',
      }
    } else {
      const outcome = await uploadRuns(
        root,
        payloads,
        { offline: opts.offline === true },
        deps
      )
      log = { commits: shas, skipped, unrecorded, ...outcome }
    }
  }

  const result: LocalScanResult = {
    scanners,
    scope: range,
    filesScanned,
    skipped: [],
    elapsedMs: Math.round(performance.now() - started),
    findings,
    server: {
      source: loaded.source,
      note: loaded.note,
      repo: loaded.repo,
      fetchedAt: loaded.fetchedAt,
      pullRequest: ctx?.pullRequest?.number ?? null,
      policy: ctx?.policy ?? null,
      pr: null,
    },
    ...(depsRuns.length > 0 ? { deps: mergeDepsRuns(depsRuns) } : {}),
    ...(log ? { log } : {}),
  }
  if (opts.json) emitJson(localScanJson(result))
  else
    console.log(
      formatLocalScan(result, { width: terminalWidth(), color: colorEnabled() })
    )
  if (run.failOn !== null && meetsFailOn(findings, run.failOn))
    return EXIT_FAIL_ON
  // As on the default path: a scanner that could not finish is a failure.
  // The upload never decides the exit code.
  return incompleteScanners(result).length > 0 ? 1 : 0
}

/** LUM-1259 — the DEPS facts of several commits, as one section. */
export function mergeDepsRuns(runs: DepsScanResult[]): DepsScanResult {
  const uniq = <T>(xs: T[]) => [...new Set(xs)].sort()
  return {
    mode: 'fast',
    source: runs[0]!.source,
    lockfiles: uniq(runs.flatMap(r => r.lockfiles)),
    packagesChecked: runs.reduce((n, r) => n + (r.packagesChecked ?? 0), 0),
    findings: runs.flatMap(r => r.findings),
    ignored: runs.flatMap(r => r.ignored),
    notCovered: uniq(runs.flatMap(r => r.notCovered)),
    incomplete: runs.find(r => r.incomplete)?.incomplete ?? null,
  }
}
