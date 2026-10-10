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
  denySandboxEgress,
  repoCheckoutDir,
  restrictSandboxEgress,
  type RepoSandbox,
} from '@/ee/security/integrations/vercel-sandbox'
import {
  getRepoCloneToken,
  revokeInstallationToken,
} from '@/lib/integrations/github/auth'
import { scrubSandboxCredentials } from './sandbox-credential-scrub'
import { fetchPrDiff } from '@/lib/integrations/github/contents'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import {
  changedLinesOfDiff,
  MAX_SCANNED_LINE_CHARS,
  normalizeSarif,
  parseSarif,
  redactKnownSecrets,
  redactPrivateKeyBlocks,
  trivyFileLevelKeys,
} from '@/ee/security/security-scan'
import {
  MANAGED_REPORT_PATH,
  MANAGED_SIDECAR_PATH,
  SHA_GUARD_EXIT,
  managedInstallScript,
  managedToolScript,
} from './security-managed-scan.scripts'
import {
  BASELINE_MAX_FINGERPRINTS,
  MANAGED_FAILURE_REASON_CHARS,
  MANAGED_REPORT_MAX_BYTES,
  MANAGED_SCAN_DONE_PATH,
  MANAGED_SCAN_TOOLS,
  SANDBOX_IMAGE,
  SCAN_EGRESS_ALLOWLIST,
  SANDBOX_SCAN_TAG,
  SANDBOX_TIMEOUT_MS,
  SANDBOX_TIMEOUT_WITH_HUNT_MS,
  SANDBOX_VCPUS,
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

/** `headSha` is validated by the caller before this is ever invoked. */
const HEAD_SHA_RE = /^[0-9a-f]{7,40}$/

/** osv-scanner: "No package sources found" (cmd/osv-scanner/internal/cmd/run.go). */
/**
 * How much of a failed tool's stderr is persisted onto the scan row. Short on
 * purpose: this string is rendered to the customer as the scanner's reason
 * (`externalFailureReason`), and the tail is where the cause is.
 */
const MANAGED_FAILURE_DETAIL_CHARS = Math.floor(
  MANAGED_FAILURE_REASON_CHARS / MANAGED_SCAN_TOOLS.length
)

const OSV_NO_PACKAGE_SOURCES_EXIT = 128

/** zizmor: "no inputs collected" — the tree has no workflows or actions to audit. */
const ZIZMOR_NO_INPUTS_EXIT = 3

/**
 * zizmor documents 11–14 as "findings, by highest severity"; SARIF output is
 * documented to suppress them, but a report that exists alongside one is still
 * a report.
 */
const ZIZMOR_FINDINGS_EXITS: readonly number[] = [11, 12, 13, 14]

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
 * semgrep and osv-scanner exit 1 when they have findings; gitleaks and trivy
 * are pinned to --exit-code 0; zizmor has its own findings band (LUM-846).
 */
function isSuccessExit(tool: ManagedScanTool, code: number): boolean {
  if (code === 0) return true
  if (tool === 'gitleaks' || tool === 'trivy') return false
  if (tool === 'zizmor') return ZIZMOR_FINDINGS_EXITS.includes(code)
  return code === 1
}

/** A non-success exit that is a fact about the tree, not a failure of the tool. */
function isSkipExit(tool: ManagedScanTool, code: number): boolean {
  return (
    (tool === 'osv-scanner' && code === OSV_NO_PACKAGE_SOURCES_EXIT) ||
    (tool === 'zizmor' && code === ZIZMOR_NO_INPUTS_EXIT)
  )
}

const SKIP_REASON: Partial<Record<ManagedScanTool, string>> = {
  'osv-scanner': 'found no package sources',
  zizmor: 'found no GitHub Actions workflows or actions',
}

/**
 * An exit that osv-scanner documents as being ABOUT THE RESULTS rather than
 * about the tool. Worth reading the report for; not worth guessing at.
 */
function isResultBandExit(tool: ManagedScanTool, code: number): boolean {
  const [lo, hi] = OSV_RESULT_BAND
  return (
    tool === 'osv-scanner' &&
    code !== SHA_GUARD_EXIT &&
    code >= lo &&
    code <= hi
  )
}

/**
 * stderr, made safe to PUBLISH. This string does not stay in a log: it becomes
 * `PrSecurityScan.error`, and from there the GitHub PR comment, the web panel
 * and `lumo task status`. `scrubToken` only knows the installation token —
 * gitleaks and semgrep speak about matched content, so their stderr can quote
 * the very secret the layer exists to find, and "Code scan failed: …" is then
 * emailed to every watcher of the pull request.
 *
 * Window ordering is load-bearing: `redactKnownSecrets` scans from the HEAD and
 * drops everything past its cap, so redacting the raw string would discard the
 * tail — which under `set -e` is where the failing command speaks. Cut the tail
 * window first, redact inside it, then cut to the budget.
 */
function failureDetail(stderr: string, token: string): string {
  // A PEM block is redacted whole BEFORE the tail cut: cut first, and a window
  // starting mid-block would keep body text with no BEGIN marker left to match.
  const flat = redactPrivateKeyBlocks(scrubToken(stderr, token))
    .text.replace(/[\r\n]+/g, ' ')
    .trim()
  const tail = redactKnownSecrets(flat.slice(-MAX_SCANNED_LINE_CHARS)).slice(
    -MANAGED_FAILURE_DETAIL_CHARS
  )
  return tail.length > 0 ? `: ${tail}` : ''
}

/**
 * LUM-876 — a setup step of OURS refused to let the scanners run (fail
 * closed). The message is published — it becomes `PrSecurityScan.error` and
 * from there "Code scan failed: …" on the PR — so it says whose failure it
 * is. "refusing to scan" read as if the customer's repository had tripped
 * something; it had not. The step retries a thrown error on its own (a fresh
 * VM, a fresh token), so by the time this text is published the retries are
 * spent: it owns the fault and asks the customer for nothing. The detail
 * (a caller-supplied error, unbounded) goes LAST, so the 480-char cut on the
 * published reason eats the detail, never the exoneration.
 */
function notFinishedOnOurSide(what: string): Error {
  return new Error(
    `this scan didn't finish on our side, even after retrying. Nothing in your repository caused this. (${what})`
  )
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Strips CR/LF and caps length before a caller-supplied string reaches a log line. */
function logSafe(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').slice(0, 120)
}

// `repoCheckoutDir` moved to the sandbox integration (LUM-746, once shared with
// the managed CI); re-exported so existing importers and this file's test
// keep working.
export { repoCheckoutDir }

type ToolReport = Buffer | { failed: string } | { skipped: string }

/** What one sandbox run hands back: each tool's SARIF, plus LUM-851 sidecars. */
interface CollectedReports {
  reports: Partial<Record<ManagedScanTool, ToolReport>>
  sidecars: Partial<Record<ManagedScanTool, Buffer>>
  /** LUM-975 — where the tools ran; absolute result paths are made relative to it. */
  checkoutDir: string
}

async function runTool(
  sandbox: RepoSandbox,
  tool: ManagedScanTool,
  label: string,
  token: string,
  headSha: string,
  cwd: string
): Promise<ToolReport> {
  const result = await sandbox.run(
    'sh',
    ['-c', managedToolScript(tool, headSha)],
    {
      cwd,
    }
  )
  if (isSkipExit(tool, result.exitCode)) {
    const why = SKIP_REASON[tool] ?? 'had nothing to scan'
    logger.info(
      `[security-managed-scan] ${logSafe(tool)} skipped (exit ${result.exitCode}: ${why}) ${label}`
    )
    return { skipped: `${tool} ${why}` }
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
  const report = await sandbox.readFile(MANAGED_REPORT_PATH[tool])
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
 * The sandbox run. LUM-852 fixed its order, and the order is the point:
 *
 *   1. clone with a token scoped to this repository, `contents: read`;
 *   2. revoke that token — the clone was its only use;
 *   3. prove the token is not readable in the VM (`scrubSandboxCredentials`);
 *   4. install every scanner (network open, nothing reads the checkout);
 *   5. narrow egress to `SCAN_EGRESS_ALLOWLIST`;
 *   6. run the scanners — the first point anything reads repository config;
 *   7. keepAlive: set deny-all and write `MANAGED_SCAN_DONE_PATH` for the hunt.
 *
 * 2, 3 and 5 are fail-closed: no scanner runs on a VM that could still hand out
 * the token or reach an arbitrary host. The raw reports (which may contain
 * secrets) come back to the caller in this same process; nothing here is
 * persisted. Throws (scrubbed) on sandbox or setup failure — transient by
 * contract.
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
}): Promise<CollectedReports> {
  const { token } = opts
  let sandbox: RepoSandbox
  let revoked = false
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
  } finally {
    // Success or not, the clone is over and the token has no further use.
    revoked = await revokeInstallationToken(token)
  }
  // LUM-869 — a token we could not revoke is live for up to an hour, and the
  // scanners are about to read repository-controlled config on this VM. The
  // scrub below proves the token is not readable NOW; it cannot cover the
  // hour. Fail closed: no scanner runs, the VM is stopped, and the step's
  // retry mints (and revokes) a fresh token.
  if (!revoked) {
    logger.error(
      `[security-managed-scan] clone token revoke failed ${opts.label}; refusing to scan`
    )
    await stopSandbox(sandbox, opts)
    throw notFinishedOnOurSide('we could not revoke our temporary clone token')
  }
  // LUM-758's keepAlive hands a FINISHED VM to the hunt; a run that throws
  // anywhere below hands over nothing, so its VM is stopped like any other
  // (LUM-852 — it used to be left to run out its 35 minutes).
  let handOver = false
  try {
    const cwd = repoCheckoutDir(sandbox.cwd, opts.repository)
    try {
      await scrubSandboxCredentials({ sandbox, cwd, token }, opts.repository)
    } catch (error) {
      throw notFinishedOnOurSide(
        `our sandbox credential check failed: ${scrubToken(message(error), token)}`
      )
    }
    const reports: Partial<Record<ManagedScanTool, ToolReport>> = {}
    const sidecars: Partial<Record<ManagedScanTool, Buffer>> = {}
    for (const tool of MANAGED_SCAN_TOOLS) {
      try {
        const failed = await installTool(sandbox, tool, opts.label, token)
        if (failed) reports[tool] = failed
      } catch (error) {
        throw new Error(scrubToken(message(error), token))
      }
    }
    try {
      await restrictSandboxEgress(sandbox.name, SCAN_EGRESS_ALLOWLIST)
    } catch (error) {
      throw notFinishedOnOurSide(
        `we could not restrict our sandbox's network: ${scrubToken(message(error), token)}`
      )
    }
    for (const tool of MANAGED_SCAN_TOOLS) {
      if (reports[tool]) continue
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
      const sidecarPath = MANAGED_SIDECAR_PATH[tool]
      if (sidecarPath && Buffer.isBuffer(reports[tool])) {
        const sidecar = await readSidecar(sandbox, sidecarPath, tool, opts)
        if (sidecar) sidecars[tool] = sidecar
      }
    }
    // LUM-869 — a failed hand-off costs the hunt its shared VM (it boots its
    // own), never the reports: they are already in hand.
    if (opts.keepAlive) handOver = await sealForHunt(sandbox, opts)
    return { reports, sidecars, checkoutDir: cwd }
  } finally {
    // A VM the hunt is going to reuse outlives this function on purpose:
    // stopping it would kill the hunt's checkout. Its release is the VM's own
    // timeout — LUM-745's sweep and supersede only reach a VM whose scan row
    // carries a `managedRunId` (see `stopHuntSandbox`).
    if (!handOver) await stopSandbox(sandbox, opts)
  }
}

async function stopSandbox(
  sandbox: RepoSandbox,
  opts: { label: string; token: string }
): Promise<void> {
  try {
    await sandbox.stop()
  } catch (error) {
    logger.warn(
      `[security-managed-scan] sandbox stop failed ${opts.label}: ${scrubToken(message(error), opts.token).slice(0, 200)}`
    )
  }
}

/**
 * LUM-852 phase 1 for one tool. A tool that cannot be installed is that
 * tool's failure (returned), like a scanner's own bad exit — the others
 * still run.
 */
async function installTool(
  sandbox: RepoSandbox,
  tool: ManagedScanTool,
  label: string,
  token: string
): Promise<ToolReport | null> {
  const result = await sandbox.run('sh', ['-c', managedInstallScript(tool)], {
    cwd: '/tmp',
  })
  if (result.exitCode === 0) return null
  logger.warn(
    `[security-managed-scan] ${logSafe(tool)} install exit ${result.exitCode} ${label}`
  )
  return {
    failed: `${tool} install exit ${result.exitCode}${failureDetail(result.stderr, token)}`,
  }
}

/**
 * LUM-852 — the hand-off to the hunt: deny-all first, the marker second, so a
 * marker can only ever mean "the network is already cut". false when either
 * fails (LUM-869: it used to throw and take the finished reports with it);
 * the caller then stops the VM and the hunt boots its own.
 */
async function sealForHunt(
  sandbox: RepoSandbox,
  opts: { label: string; token: string }
): Promise<boolean> {
  try {
    await denySandboxEgress(sandbox.name)
    const marked = await sandbox.run('touch', [MANAGED_SCAN_DONE_PATH], {
      cwd: '/tmp',
    })
    if (marked.exitCode !== 0) {
      throw new Error(`touch exit ${marked.exitCode}`)
    }
    return true
  } catch (error) {
    logger.warn(
      `[security-managed-scan] could not hand the sandbox to the hunt ${opts.label}: ${scrubToken(message(error), opts.token).slice(0, 200)}; stopping it`
    )
    return false
  }
}

/**
 * LUM-851 — a sidecar only sharpens lines, so losing one must cost exactly
 * that: no sidecar (unreadable, oversized) is a warning, the SARIF stands.
 */
async function readSidecar(
  sandbox: RepoSandbox,
  path: string,
  tool: ManagedScanTool,
  opts: { label: string; token: string }
): Promise<Buffer | null> {
  try {
    const buf = await sandbox.readFile(path)
    if (buf && buf.byteLength <= MANAGED_REPORT_MAX_BYTES) return buf
    logger.warn(
      `[security-managed-scan] ${logSafe(tool)} sidecar ${buf ? `${buf.byteLength}B over cap` : 'missing'} ${opts.label}, keeping SARIF lines`
    )
  } catch (error) {
    logger.warn(
      `[security-managed-scan] ${logSafe(tool)} sidecar unreadable ${opts.label}: ${scrubToken(message(error), opts.token).slice(0, 200)}`
    )
  }
  return null
}

/** LUM-851 — the file-level result keys a tool's sidecar names; empty when it names none or is unusable. */
function fileLevelResultsOf(
  tool: ManagedScanTool,
  sidecar: Buffer | undefined,
  label: string
): Set<string> {
  if (!sidecar || tool !== 'trivy') return new Set()
  try {
    return trivyFileLevelKeys(JSON.parse(sidecar.toString('utf8')))
  } catch {
    logger.warn(
      `[security-managed-scan] ${logSafe(tool)} sidecar is not JSON ${label}, keeping SARIF lines`
    )
    return new Set()
  }
}

/** Parse + normalize every report in-process; per-tool failures are values. */
function normalizeReports(
  { reports, sidecars, checkoutDir }: CollectedReports,
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
          checkoutDir,
          fileLevelResults: fileLevelResultsOf(
            tool,
            sidecars[tool],
            opts.label
          ),
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
    const token = await getRepoCloneToken(job.pr.workspaceId, job.pr.repo)
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
    // anything leaves this function. The sandbox is already stopped (or, for
    // the hunt, sealed) and the clone token already revoked here.
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
      changedLines: changedLinesOfDiff(diff),
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
    const token = await getRepoCloneToken(job.workspaceId, job.repo)
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
