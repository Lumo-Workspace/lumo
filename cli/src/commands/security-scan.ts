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
  staged?: boolean
  since?: string
  json?: boolean
  failOn?: string
  /** LUM-1256 — read the server context from the cache only. */
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
  return picked.length > 0 ? picked : ['SECRETS']
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
 */
export async function securityScanCommand(
  opts: SecurityScanOptions,
  deps: ScanContextDeps = {}
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

  const started = performance.now()
  const diff = collectLocalDiff(scope)
  const scanned: LocalFinding[] = scanners.includes('SECRETS')
    ? scanSecrets(diff.files).map(f => ({ ...f, scanner: 'SECRETS' as const }))
    : []
  const { findings, server } = await withServerContext(
    scanned,
    {
      root: diff.root,
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
    scope: diff.description,
    filesScanned: diff.files.length,
    skipped: diff.skipped,
    elapsedMs: Math.round(performance.now() - started),
    findings,
    server,
  }

  if (opts.json) emitJson(localScanJson(result))
  else
    console.log(
      formatLocalScan(result, { width: terminalWidth(), color: colorEnabled() })
    )
  return failOn !== null && meetsThreshold(findings, failOn) ? EXIT_FAIL_ON : 0
}
