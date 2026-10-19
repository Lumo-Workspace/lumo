import { scanSecrets } from '../../../shared/src/secret-scan/scan-secrets'
import { EXIT_USAGE } from '../lib/exit-codes'
import { emitJson } from '../lib/json-output'
import { collectLocalDiff, type ScanScope } from '../lib/local-diff'
import {
  EXIT_FAIL_ON,
  formatLocalScan,
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
  staged?: boolean
  since?: string
  json?: boolean
  failOn?: string
}

/** The scanners a run selects: the flags given, or every local scanner. */
export function selectScanners(opts: SecurityScanOptions): LocalScanner[] {
  const picked: LocalScanner[] = []
  if (opts.secrets) picked.push('SECRETS')
  return picked.length > 0 ? picked : ['SECRETS']
}

/**
 * LUM-1255 — `lumo security scan`: Lumo's scanners over the lines a local
 * diff adds. `SECRETS` is the PR scan's deterministic secret scanner
 * (`shared/src/secret-scan`, the same code stage A runs): no network, no
 * binary, findings carry the server's fingerprints. Read-only: nothing is
 * uploaded or written.
 */
export async function securityScanCommand(
  opts: SecurityScanOptions
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

  const started = performance.now()
  const diff = collectLocalDiff(scope)
  const findings: LocalFinding[] = scanners.includes('SECRETS')
    ? scanSecrets(diff.files).map(f => ({ ...f, scanner: 'SECRETS' as const }))
    : []
  const result: LocalScanResult = {
    scanners,
    scope: diff.description,
    filesScanned: diff.files.length,
    skipped: diff.skipped,
    elapsedMs: Math.round(performance.now() - started),
    findings,
  }

  if (opts.json) emitJson(localScanJson(result))
  else
    console.log(
      formatLocalScan(result, { width: terminalWidth(), color: colorEnabled() })
    )
  return failOn !== null && meetsThreshold(findings, failOn) ? EXIT_FAIL_ON : 0
}
