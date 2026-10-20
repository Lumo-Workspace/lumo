import { scanSecrets } from '../../../shared/src/secret-scan/scan-secrets'
import { scanDeps, type DepsScanResult } from '../lib/deps-scan'
import { EXIT_USAGE } from '../lib/exit-codes'
import { emitJson } from '../lib/json-output'
import {
  collectLocalDiff,
  resolveScanBase,
  type ScanScope,
} from '../lib/local-diff'
import {
  EXIT_FAIL_ON,
  formatLocalScan,
  incompleteScanners,
  localScanJson,
  meetsThreshold,
  parseSeverity,
  SEVERITIES,
  type LocalFinding,
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
  type ScanContextDeps,
} from '../lib/scan-context'
import { comparePrFindings, labelFinding } from '../lib/scan-labels'
import { colorEnabled, terminalWidth } from '../lib/ui'

export interface SecurityScanOptions {
  secrets?: boolean
  deps?: boolean
  /** DEPS: run osv-scanner over the whole tree instead of the lockfile delta. */
  full?: boolean
  staged?: boolean
  since?: string
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
}

/** The scanners a run selects: the flags given, or every local scanner. */
export function selectScanners(opts: SecurityScanOptions): LocalScanner[] {
  const picked: LocalScanner[] = []
  if (opts.secrets) picked.push('SECRETS')
  if (opts.deps) picked.push('DEPS')
  return picked.length > 0 ? picked : ['SECRETS', 'DEPS']
}

/** Test seams: the server context's (LUM-1256) plus the DEPS scanner's OSV API and binary. */
export interface SecurityScanDeps extends ScanContextDeps {
  osvFetch?: typeof fetch
  scannerBin?: string
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
  },
  deps: ScanContextDeps = {}
): Promise<{ findings: LocalFinding[]; server: ServerSection }> {
  const repo = input.repo ?? detectRepo(input.root)
  const loaded = await loadScanContext(
    { repo, branch: detectBranch(input.root), offline: input.offline },
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
      const scan = await loadPrScan(number, loaded.repo, deps)
      if (!scan.ok) {
        pr = { number, headSha: null, note: scan.note, comparison: null }
      } else if (input.scope.kind !== 'default') {
        pr = {
          number,
          headSha: scan.headSha,
          note: 'not compared: --staged / --since do not cover the PR diff',
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
  if (opts.pr && opts.offline) {
    console.error('Error: --pr reads the server; it cannot run with --offline')
    return EXIT_USAGE
  }
  if (opts.repo !== undefined && !/^[^/\s]+\/[^/\s]+$/.test(opts.repo)) {
    console.error(`Error: invalid --repo "${opts.repo}" (expected owner/name)`)
    return EXIT_USAGE
  }
  const failOn = opts.failOn === undefined ? null : parseSeverity(opts.failOn)
  if (opts.failOn !== undefined && failOn === null) {
    console.error(
      `Error: invalid --fail-on "${opts.failOn}" (allowed: ${SEVERITIES.map(s => s.toLowerCase()).join(', ')})`
    )
    return EXIT_USAGE
  }
  const scope: ScanScope = opts.staged
    ? { kind: 'staged' }
    : opts.since !== undefined
      ? { kind: 'since', ref: opts.since }
      : { kind: 'default' }
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
  if (failOn !== null && meetsThreshold(findings, failOn)) return EXIT_FAIL_ON
  // A scanner that could not finish is a failure, not a clean result.
  return incompleteScanners(result).length > 0 ? 1 : 0
}
