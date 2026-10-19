import { scanSecrets } from '../../../shared/src/secret-scan/scan-secrets'
import { collectLocalDiff, type ScanScope } from '../lib/local-diff'
import {
  EXIT_FAIL_ON,
  formatLocalScan,
  localScanJson,
  meetsThreshold,
  parseSeverity,
  SEVERITIES,
  type LocalScanResult,
} from '../lib/local-scan-report'
import { colorEnabled, terminalWidth } from '../lib/ui'

export interface ScanSecretsOptions {
  staged?: boolean
  since?: string
  json?: boolean
  failOn?: string
}

/**
 * LUM-1255 — `lumo scan secrets`: the PR scan's deterministic secret scanner
 * (`shared/src/secret-scan`, the same code stage A runs) over the lines a
 * local diff adds. No network, no binary; findings carry the server's
 * fingerprints. Read-only: nothing is uploaded or written.
 */
export async function scanSecretsCommand(
  opts: ScanSecretsOptions
): Promise<number> {
  if (opts.staged && opts.since !== undefined) {
    throw new Error('Pass either --staged or --since <ref>, not both.')
  }
  const failOn = opts.failOn === undefined ? null : parseSeverity(opts.failOn)
  if (opts.failOn !== undefined && failOn === null) {
    throw new Error(
      `--fail-on must be one of ${SEVERITIES.map(s => s.toLowerCase()).join(', ')}.`
    )
  }
  const scope: ScanScope = opts.staged
    ? { kind: 'staged' }
    : opts.since !== undefined
      ? { kind: 'since', ref: opts.since }
      : { kind: 'default' }

  const started = performance.now()
  const diff = collectLocalDiff(scope)
  const findings = scanSecrets(diff.files)
  const result: LocalScanResult = {
    scanner: 'secrets',
    scope: diff.description,
    filesScanned: diff.files.length,
    skipped: diff.skipped,
    elapsedMs: Math.round(performance.now() - started),
    findings,
  }

  console.log(
    opts.json
      ? JSON.stringify(localScanJson(result), null, 2)
      : formatLocalScan(result, {
          width: terminalWidth(),
          color: colorEnabled(),
        })
  )
  return failOn !== null && meetsThreshold(findings, failOn) ? EXIT_FAIL_ON : 0
}
