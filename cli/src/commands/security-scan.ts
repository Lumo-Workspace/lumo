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
} from '../lib/local-scan-report'
import { colorEnabled, terminalWidth } from '../lib/ui'

export interface SecurityScanOptions {
  secrets?: boolean
  deps?: boolean
  /** DEPS: run osv-scanner over the whole tree instead of the lockfile delta. */
  full?: boolean
  /** Make no network call: DEPS uses osv-scanner's local database. */
  offline?: boolean
  staged?: boolean
  since?: string
  json?: boolean
  failOn?: string
}

/** The scanners a run selects: the flags given, or every local scanner. */
export function selectScanners(opts: SecurityScanOptions): LocalScanner[] {
  const picked: LocalScanner[] = []
  if (opts.secrets) picked.push('SECRETS')
  if (opts.deps) picked.push('DEPS')
  return picked.length > 0 ? picked : ['SECRETS', 'DEPS']
}

/** Test seam: the DEPS scanner's network and binary. */
export interface SecurityScanDeps {
  fetchImpl?: typeof fetch
  scannerBin?: string
  now?: Date
}

/**
 * LUM-1255 — `lumo security scan`: Lumo's scanners over the lines a local
 * diff adds. `SECRETS` is the PR scan's deterministic secret scanner
 * (`shared/src/secret-scan`, the same code stage A runs): no network, no
 * binary, findings carry the server's fingerprints. Read-only: nothing is
 * uploaded or written.
 *
 * LUM-1257 — `DEPS`: vulnerable / malicious dependencies with the managed
 * scan's osv-scanner identity (`lib/deps-scan.ts`). Its default fast mode
 * sends changed package names and versions to api.osv.dev; an unanswered
 * lookup makes the scan incomplete (exit 1 unless `--fail-on` is met),
 * never clean.
 */
export async function securityScanCommand(
  opts: SecurityScanOptions,
  seams: SecurityScanDeps = {}
): Promise<number> {
  if (opts.staged && opts.since !== undefined) {
    console.error('Error: pass either --staged or --since <ref>, not both')
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
  if ((opts.full || opts.offline) && !scanners.includes('DEPS')) {
    console.error('Error: --full and --offline apply to --deps')
    return EXIT_USAGE
  }

  const started = performance.now()
  const base = resolveScanBase(scope)
  const diff = scanners.includes('SECRETS') ? collectLocalDiff(scope) : null
  const deps: DepsScanResult | undefined = scanners.includes('DEPS')
    ? await scanDeps(base, {
        full: opts.full === true,
        offline: opts.offline === true,
        ...seams,
      })
    : undefined
  const findings: LocalFinding[] = [
    ...(diff
      ? scanSecrets(diff.files).map(f => ({
          ...f,
          scanner: 'SECRETS' as const,
        }))
      : []),
    ...(deps?.findings ?? []),
  ]
  const result: LocalScanResult = {
    scanners,
    scope: base.description,
    filesScanned: diff?.files.length ?? 0,
    skipped: diff?.skipped ?? [],
    elapsedMs: Math.round(performance.now() - started),
    findings,
    ...(deps ? { deps } : {}),
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
