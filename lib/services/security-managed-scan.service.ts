/**
 * LUM-735 v5 — Lumo-managed scan (spec §6 L1 v0.3): run gitleaks + semgrep
 * (+ osv-scanner, LUM-738 §6 L2) against one revision inside a one-shot
 * Vercel Sandbox and normalize the SARIF in the same process. Everything
 * secret-bearing — the installation token, the clone, the raw SARIF — stays
 * inside this module; what leaves is the same redacted `NormalizeOutcome`
 * the BYO push produces.
 *
 * Two entry points share the sandbox run:
 *   scanRepository  a PR head sha, diff-aware (LUM-735)
 *   scanBaseline    the default-branch head, whole-tree, fingerprints only —
 *                   the repository baseline that decides `persisting` for
 *                   findings that have no line-level diff (LUM-738)
 *
 * Retry contract (same as the ingest service): transient failures (sandbox
 * creation, clone, GitHub diff) throw so the workflow step retries; a
 * scanner's own failure (unexpected exit code, no report, bad SARIF) is
 * returned as `{ kind: 'failed' }` for that tool and the other tools still
 * run. osv-scanner exiting 128 ("no package sources") is `{ kind: 'skipped' }`.
 */
import { logger } from '@/lib/logger'
import {
  createRepoSandbox,
  repoCheckoutDir,
  type RepoSandbox,
} from '@/lib/integrations/vercel-sandbox'
import { getGithubInstallationToken } from '@/lib/integrations/github/auth'
import { fetchPrDiff } from '@/lib/integrations/github/contents'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import {
  addedLinesWithNumbers,
  changedLinesOf,
  normalizeSarif,
  parseSarif,
} from '@/lib/security-scan'
import {
  BASELINE_MAX_FINGERPRINTS,
  GITLEAKS_URL,
  MANAGED_REPORT_MAX_BYTES,
  MANAGED_SCAN_TOOLS,
  OSV_SCANNER_URL,
  SANDBOX_IMAGE,
  SANDBOX_SCAN_TAG,
  SANDBOX_TIMEOUT_MS,
  SANDBOX_TIMEOUT_WITH_HUNT_MS,
  SANDBOX_VCPUS,
  SEMGREP_CONFIGS,
  SEMGREP_VERSION,
  supersededOutcome,
  type BaselineScanJob,
  type BaselineScanOutcome,
  type ManagedScanJob,
  type ManagedScanOutcome,
  type ManagedScanTool,
  type ManagedToolOutcome,
} from './security-managed-scan.config'

// Re-exported so existing consumers (and this file's own test) keep working
// unchanged. New consumers that don't need the sandbox/GitHub SDKs — the
// workflow orchestrator, stage A — should import from
// `./security-managed-scan.config` directly instead of through this module.
export * from './security-managed-scan.config'

/** Every string that leaves this module passes through here (P8). */
export function scrubToken(message: string, token: string): string {
  return token ? message.split(token).join('***') : message
}

const REPORT_PATH: Record<ManagedScanTool, string> = {
  gitleaks: '/tmp/gitleaks.sarif',
  semgrep: '/tmp/semgrep.sarif',
  'osv-scanner': '/tmp/osv.sarif',
}

const SCRIPT_BODY: Record<ManagedScanTool, string> = {
  gitleaks: `set -e; curl -sSL "${GITLEAKS_URL}" | tar -xz -C /tmp gitleaks; /tmp/gitleaks dir . --report-format sarif --report-path ${REPORT_PATH.gitleaks} --exit-code 0 --no-banner`,
  semgrep: `set -e; python3 -m pip install --quiet semgrep==${SEMGREP_VERSION}; semgrep scan ${SEMGREP_CONFIGS.map(c => `--config ${c}`).join(' ')} --sarif --output ${REPORT_PATH.semgrep} --metrics=off`,
  // Release binary (no package manager); `scan source -r .` walks every
  // lockfile / manifest osv-scanner knows; SARIF goes to a file so stdout
  // (which may echo advisory text) is never parsed.
  'osv-scanner': `set -e; curl -sSL -o /tmp/osv-scanner "${OSV_SCANNER_URL}"; chmod +x /tmp/osv-scanner; /tmp/osv-scanner scan source -r . --format sarif --output-file ${REPORT_PATH['osv-scanner']}`,
}

/** `headSha` is validated by the caller before this is ever invoked. */
const HEAD_SHA_RE = /^[0-9a-f]{7,40}$/

/** osv-scanner: "No package sources found" (cmd/osv-scanner/internal/cmd/run.go). */
/**
 * How much of a failed tool's stderr is persisted onto the scan row. Short on
 * purpose: this string is rendered to the customer as the scanner's reason
 * (`externalFailureReason`), and the tail is where the cause is.
 */
const MANAGED_FAILURE_DETAIL_CHARS = 160

const OSV_NO_PACKAGE_SOURCES_EXIT = 128

/**
 * osv-scanner v2 documents its exit codes as BANDS, not as a list
 * (google.github.io/osv-scanner/output): 0 no findings, 1 findings, **1–126
 * reserved for result-related errors**, 127 general error, 128 no packages,
 * 129–255 reserved for non-result errors.
 *
 * We treated everything outside {0, 1, 128} as a tool failure, so a code from
 * the documented result band was discarded unread. Production hit exit 2 —
 * which the docs do not name individually but do place inside that band — and
 * the layer landed FAILED with zero findings, on a run whose report may well
 * have been sitting in /tmp.
 *
 * The exit code alone cannot settle it (`set -e` also surfaces `curl`'s codes
 * from the same script, and curl's 2 is "failed to initialize"), so this is
 * deliberately NOT an allow-list of codes we have guessed the meaning of. An
 * unusual code inside the band is a question, and the answer is whether the
 * tool produced a readable report: results that parse are results, whatever
 * the number was. Anything outside the band, or inside it with no report, is
 * a failure — and now says WHY.
 */
const OSV_RESULT_BAND: readonly [number, number] = [1, 126]

/**
 * Guards against a mis-rooted or wrong-revision sandbox scanning the wrong
 * tree and silently passing (P9): the guard exits 90 — that tool's normal
 * non-success exit — when the checkout at cwd is not exactly `headSha`.
 * `headSha` is interpolated into a shell script, so it must be validated
 * (see `HEAD_SHA_RE`) before this is ever called.
 */
function scriptFor(tool: ManagedScanTool, headSha: string): string {
  const guard = `test "$(git rev-parse HEAD 2>/dev/null | cut -c1-${headSha.length})" = "${headSha}" || exit 90; `
  return guard + SCRIPT_BODY[tool]
}

/**
 * semgrep and osv-scanner exit 1 when they have findings; gitleaks is pinned
 * to --exit-code 0.
 */
function isSuccessExit(tool: ManagedScanTool, code: number): boolean {
  return tool === 'gitleaks' ? code === 0 : code === 0 || code === 1
}

/** A non-success exit that is a fact about the tree, not a failure of the tool. */
function isSkipExit(tool: ManagedScanTool, code: number): boolean {
  return tool === 'osv-scanner' && code === OSV_NO_PACKAGE_SOURCES_EXIT
}

/**
 * An exit that osv-scanner documents as being ABOUT THE RESULTS rather than
 * about the tool. Worth reading the report for; not worth guessing at.
 */
function isResultBandExit(tool: ManagedScanTool, code: number): boolean {
  const [lo, hi] = OSV_RESULT_BAND
  return tool === 'osv-scanner' && code >= lo && code <= hi
}

/** stderr, token-scrubbed and flattened to one short line, safe to persist. */
function failureDetail(stderr: string, token: string): string {
  const tail = scrubToken(stderr, token)
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(-MANAGED_FAILURE_DETAIL_CHARS)
  return tail.length > 0 ? `: ${tail}` : ''
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Strips CR/LF and caps length before a caller-supplied string reaches a log line. */
function logSafe(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').slice(0, 120)
}

// `repoCheckoutDir` moved to the sandbox integration (LUM-746, shared with
// the managed CI); re-exported so existing importers and this file's test
// keep working.
export { repoCheckoutDir }

type ToolReport = Buffer | { failed: string } | { skipped: string }

async function runTool(
  sandbox: RepoSandbox,
  tool: ManagedScanTool,
  label: string,
  token: string,
  headSha: string,
  cwd: string
): Promise<ToolReport> {
  const result = await sandbox.run('sh', ['-c', scriptFor(tool, headSha)], {
    cwd,
  })
  if (isSkipExit(tool, result.exitCode)) {
    logger.info(
      `[security-managed-scan] ${logSafe(tool)} skipped (exit ${result.exitCode}: no package sources) ${label}`
    )
    return { skipped: `${tool} found no package sources` }
  }
  const unusualResultCode =
    !isSuccessExit(tool, result.exitCode) &&
    isResultBandExit(tool, result.exitCode)
  if (!isSuccessExit(tool, result.exitCode) && !unusualResultCode) {
    logger.warn(
      `[security-managed-scan] ${logSafe(tool)} exit ${result.exitCode} ${label}: ${scrubToken(
        result.stderr,
        token
      )
        .replace(/[\r\n]+/g, ' ')
        .slice(0, 200)}`
    )
    // The number alone sent one of these to production unexplained. Carry the
    // tool's own last words: this string is the whole record a reader gets.
    return {
      failed: `${tool} exit ${result.exitCode}${failureDetail(result.stderr, token)}`,
    }
  }
  const report = await sandbox.readFile(REPORT_PATH[tool])
  if (!report) {
    if (unusualResultCode) {
      logger.warn(
        `[security-managed-scan] ${logSafe(tool)} exit ${result.exitCode} and no report ${label}: ${scrubToken(
          result.stderr,
          token
        )
          .replace(/[\r\n]+/g, ' ')
          .slice(0, 200)}`
      )
      return {
        failed: `${tool} exit ${result.exitCode}${failureDetail(result.stderr, token)}`,
      }
    }
    return { failed: `${tool} produced no report` }
  }
  if (unusualResultCode) {
    // Results that parse are results. Say the code out loud anyway — an
    // undocumented one recurring is worth someone's attention.
    logger.warn(
      `[security-managed-scan] ${logSafe(tool)} exit ${result.exitCode} (documented result band) but produced a report ${label}, using it`
    )
  }
  if (report.byteLength > MANAGED_REPORT_MAX_BYTES) {
    logger.error(
      `[security-managed-scan] ${logSafe(tool)} report ${report.byteLength}B exceeds cap ${label}`
    )
    return { failed: `${tool} report exceeds size cap` }
  }
  return report
}

/**
 * The sandbox run: clone `sha`, run every tool, read the reports, stop. The
 * raw reports (which may contain secrets) come back to the caller in this
 * same process; nothing here is persisted. Throws (scrubbed) on sandbox
 * creation or command failure — transient by contract.
 */
async function collectReports(opts: {
  repository: string
  sha: string
  token: string
  label: string
  /** LUM-745: a PR scan tags its VM with its scan id; the baseline run passes none. */
  tags?: Record<string, string>
  /**
   * LUM-758: when true the VM is NOT stopped once the tools are done — the
   * hunt attaches to it by tag instead of paying for a second microVM, and
   * nobody stops it on purpose (see `ManagedScanJob.huntWanted`).
   */
  keepAlive?: boolean
}): Promise<Partial<Record<ManagedScanTool, ToolReport>>> {
  const { token } = opts
  let sandbox: RepoSandbox
  try {
    sandbox = await createRepoSandbox({
      repository: opts.repository,
      revision: opts.sha,
      token,
      timeoutMs: opts.keepAlive
        ? SANDBOX_TIMEOUT_WITH_HUNT_MS
        : SANDBOX_TIMEOUT_MS,
      vcpus: SANDBOX_VCPUS,
      image: SANDBOX_IMAGE,
      ...(opts.tags ? { tags: opts.tags } : {}),
    })
  } catch (error) {
    // Transient by default (retry); the SDK may echo the clone URL.
    throw new Error(scrubToken(message(error), token))
  }
  try {
    const reports: Partial<Record<ManagedScanTool, ToolReport>> = {}
    const cwd = repoCheckoutDir(sandbox.cwd, opts.repository)
    for (const tool of MANAGED_SCAN_TOOLS) {
      try {
        reports[tool] = await runTool(
          sandbox,
          tool,
          opts.label,
          token,
          opts.sha,
          cwd
        )
      } catch (error) {
        throw new Error(scrubToken(message(error), token))
      }
    }
    return reports
  } finally {
    // LUM-758: a VM the hunt is going to reuse outlives this function on
    // purpose. Stopping it here would kill the hunt's checkout; stopping it
    // from the hunt would kill semgrep, since the two workflows have no
    // ordering guarantee. Its release is the VM's own 20-minute timeout —
    // LUM-745's sweep and supersede only reach a VM whose scan row carries a
    // `managedRunId` (see `stopHuntSandbox`).
    // `keepAlive` also changes the CRASH path, which is not the shared-VM
    // rule and is easy to miss: a throw above now leaves the VM running where
    // this block previously always stopped it, so with the step's retries
    // several VMs can be alive under one `lumoScan` tag at once, each until
    // its own timeout. Bounded, and cheaper than racing the hunt's checkout.
    if (!opts.keepAlive) {
      try {
        await sandbox.stop()
      } catch (error) {
        logger.warn(
          `[security-managed-scan] sandbox stop failed ${opts.label}: ${scrubToken(message(error), token).slice(0, 200)}`
        )
      }
    }
  }
}

/** Parse + normalize every report in-process; per-tool failures are values. */
function normalizeReports(
  reports: Partial<Record<ManagedScanTool, ToolReport>>,
  opts: {
    changedLines: Map<string, Set<number>> | null
    maxFindings?: number
    token: string
    label: string
  }
): ManagedScanOutcome {
  const outcome = {} as ManagedScanOutcome
  for (const tool of MANAGED_SCAN_TOOLS) {
    const report = reports[tool]
    if (!report) {
      outcome[tool] = { kind: 'failed', reason: `${tool} produced no report` }
      continue
    }
    if (!Buffer.isBuffer(report)) {
      outcome[tool] =
        'skipped' in report
          ? { kind: 'skipped', reason: report.skipped }
          : { kind: 'failed', reason: report.failed }
      continue
    }
    try {
      const n = normalizeSarif(
        parseSarif(JSON.parse(report.toString('utf8'))),
        {
          toolHint: tool,
          changedLines: opts.changedLines,
          ...(opts.maxFindings !== undefined
            ? { maxFindings: opts.maxFindings }
            : {}),
        }
      )
      outcome[tool] = {
        kind: 'ok',
        tool: n.tool,
        tools: n.tools,
        findings: n.findings,
        truncated: n.truncated,
        dropped: n.dropped,
      }
      logger.info(
        `[security-managed-scan] ${opts.label} ${logSafe(tool)}: ${n.findings.length} findings (dropped notInDiff=${n.dropped.notInDiff} noLocation=${n.dropped.noLocation} dup=${n.dropped.duplicate})`
      )
    } catch (error) {
      // Not JSON / not SARIF 2.1.0 — deterministic, the tool's own failure.
      const reason = scrubToken(message(error), opts.token).slice(0, 500)
      logger.error(
        `[security-managed-scan] ${logSafe(tool)} report unusable ${opts.label}: ${reason.slice(0, 200)}`
      )
      outcome[tool] = { kind: 'failed', reason }
    }
  }
  return outcome
}

function allFailed(reason: string): ManagedScanOutcome {
  const outcome = {} as ManagedScanOutcome
  for (const tool of MANAGED_SCAN_TOOLS) {
    outcome[tool] = { kind: 'failed', reason }
  }
  return outcome
}

export const securityManagedScanService = {
  async scanRepository(job: ManagedScanJob): Promise<ManagedScanOutcome> {
    if (!HEAD_SHA_RE.test(job.headSha)) {
      // headSha is interpolated into the sandbox shell script (scriptFor);
      // an unvalidated value must never reach there. Deterministic — no
      // sandbox is created, and every tool reports the same reason (P9).
      return allFailed('invalid head sha')
    }
    const label = `${logSafe(job.pr.repo)}#${job.pr.number} scan=${job.scanId}`
    // LUM-745: stage A may have superseded this row (a newer head arrived)
    // between start() and this step — or between a failed attempt and its
    // retry. The stamp lands BEFORE the cancel, so reading it here is enough
    // to never boot a VM for a scan nobody will read. A missing row (the PR
    // was deleted) is treated the same way.
    const stages = await prSecurityScanRepository.findStagesById(job.scanId)
    if (!stages || stages.external === 'SUPERSEDED') {
      logger.info(`[security-managed-scan] superseded before run ${label}`)
      return supersededOutcome()
    }
    const token = await getGithubInstallationToken(job.pr.workspaceId)
    const reports = await collectReports({
      repository: job.pr.repo,
      sha: job.headSha,
      token,
      label,
      tags: { [SANDBOX_SCAN_TAG]: job.scanId },
      keepAlive: job.huntWanted,
    })
    // LUM-745 (review): the entry guard covers a step that has not started;
    // a supersede that lands while the sandbox is running must not let this
    // run flip the row back to RAN or post a stale summary — re-read before
    // anything leaves this function. The sandbox is already stopped here.
    const after = await prSecurityScanRepository.findStagesById(job.scanId)
    if (!after || after.external === 'SUPERSEDED') {
      logger.info(`[security-managed-scan] superseded during run ${label}`)
      return supersededOutcome()
    }
    let diff: string
    try {
      diff = await fetchPrDiff({
        workspaceId: job.pr.workspaceId,
        fullName: job.pr.repo,
        prNumber: job.pr.number,
      })
    } catch (error) {
      // Transient by default (retry); scrub defensively even though the
      // GitHub client has no reason to echo the installation token today.
      throw new Error(scrubToken(message(error), token))
    }
    return normalizeReports(reports, {
      changedLines: changedLinesOf(addedLinesWithNumbers(diff)),
      token,
      label,
    })
  },

  /**
   * LUM-738 — the default-branch baseline: same sandbox, same tools, no
   * diff filter, fingerprints only. Nothing about a finding but its
   * fingerprint leaves this function, so the baseline column carries no
   * text at all (P8 by construction).
   */
  async scanBaseline(job: BaselineScanJob): Promise<BaselineScanOutcome> {
    const label = `${logSafe(job.repo)}@${job.sha.slice(0, 7)} baseline`
    if (!HEAD_SHA_RE.test(job.sha)) {
      return {
        fingerprints: [],
        partial: false,
        tools: [],
        failed: MANAGED_SCAN_TOOLS.map(t => `${t} invalid sha`),
        skipped: [],
      }
    }
    const token = await getGithubInstallationToken(job.workspaceId)
    const reports = await collectReports({
      repository: job.repo,
      sha: job.sha,
      token,
      label,
    })
    const outcome = normalizeReports(reports, {
      changedLines: null,
      maxFindings: BASELINE_MAX_FINGERPRINTS,
      token,
      label,
    })
    const fingerprints = new Set<string>()
    const result: BaselineScanOutcome = {
      fingerprints: [],
      partial: false,
      tools: [],
      failed: [],
      skipped: [],
    }
    for (const tool of MANAGED_SCAN_TOOLS) {
      const o: ManagedToolOutcome = outcome[tool]
      if (o.kind === 'ok') {
        for (const f of o.findings) fingerprints.add(f.fingerprint)
        result.tools.push(...o.tools)
        result.partial = result.partial || o.truncated
      } else if (o.kind === 'skipped') {
        result.skipped.push(tool)
      } else {
        result.failed.push(o.kind === 'failed' ? o.reason : `${tool} not found`)
      }
    }
    result.fingerprints = Array.from(fingerprints)
    result.tools = Array.from(new Set(result.tools))
    return result
  },
}
