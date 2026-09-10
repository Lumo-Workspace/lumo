/**
 * LUM-735 v5 — Lumo-managed scan (spec §6 L1 v0.3): run semgrep + gitleaks
 * against one PR head sha inside a one-shot Vercel Sandbox and normalize the
 * SARIF in the same process. Everything secret-bearing — the installation
 * token, the clone, the raw SARIF — stays inside `scanRepository`; the value
 * it returns is the same redacted `NormalizeOutcome` the BYO push produces.
 *
 * Retry contract (same as the ingest service): transient failures (sandbox
 * creation, clone, GitHub diff) throw so the workflow step retries; a
 * scanner's own failure (unexpected exit code, no report, bad SARIF) is
 * returned as `{ kind: 'failed' }` for that tool and the other tool still
 * runs.
 */
import { logger } from '@/lib/logger'
import {
  createRepoSandbox,
  type RepoSandbox,
} from '@/lib/integrations/vercel-sandbox'
import { getGithubInstallationToken } from '@/lib/integrations/github/auth'
import { fetchPrDiff } from '@/lib/integrations/github/contents'
import {
  addedLinesWithNumbers,
  changedLinesOf,
  normalizeSarif,
  parseSarif,
} from '@/lib/security-scan'
import {
  GITLEAKS_URL,
  MANAGED_REPORT_MAX_BYTES,
  MANAGED_SCAN_TOOLS,
  SANDBOX_IMAGE,
  SANDBOX_TIMEOUT_MS,
  SANDBOX_VCPUS,
  SEMGREP_CONFIGS,
  SEMGREP_VERSION,
  type ManagedScanJob,
  type ManagedScanOutcome,
  type ManagedScanTool,
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
}

const SCRIPT_BODY: Record<ManagedScanTool, string> = {
  gitleaks: `set -e; curl -sSL "${GITLEAKS_URL}" | tar -xz -C /tmp gitleaks; /tmp/gitleaks dir . --report-format sarif --report-path ${REPORT_PATH.gitleaks} --exit-code 0 --no-banner`,
  semgrep: `set -e; python3 -m pip install --quiet semgrep==${SEMGREP_VERSION}; semgrep scan ${SEMGREP_CONFIGS.map(c => `--config ${c}`).join(' ')} --sarif --output ${REPORT_PATH.semgrep} --metrics=off`,
}

/** `headSha` is validated by the caller before this is ever invoked. */
const HEAD_SHA_RE = /^[0-9a-f]{7,40}$/

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

/** semgrep exits 1 when it has findings; gitleaks is pinned to --exit-code 0. */
function isSuccessExit(tool: ManagedScanTool, code: number): boolean {
  return tool === 'semgrep' ? code === 0 || code === 1 : code === 0
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Strips CR/LF and caps length before a caller-supplied string reaches a log line. */
function logSafe(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').slice(0, 120)
}

async function runTool(
  sandbox: RepoSandbox,
  tool: ManagedScanTool,
  scanId: string,
  token: string,
  headSha: string
): Promise<Buffer | { failed: string }> {
  const result = await sandbox.run('sh', ['-c', scriptFor(tool, headSha)])
  if (!isSuccessExit(tool, result.exitCode)) {
    logger.warn(
      `[security-managed-scan] ${logSafe(tool)} exit ${result.exitCode} scan=${scanId}: ${scrubToken(
        result.stderr,
        token
      )
        .replace(/[\r\n]+/g, ' ')
        .slice(0, 200)}`
    )
    return { failed: `${tool} exit ${result.exitCode}` }
  }
  const report = await sandbox.readFile(REPORT_PATH[tool])
  if (!report) return { failed: `${tool} produced no report` }
  if (report.byteLength > MANAGED_REPORT_MAX_BYTES) {
    logger.error(
      `[security-managed-scan] ${logSafe(tool)} report ${report.byteLength}B exceeds cap scan=${scanId}`
    )
    return { failed: `${tool} report exceeds size cap` }
  }
  return report
}

export const securityManagedScanService = {
  async scanRepository(job: ManagedScanJob): Promise<ManagedScanOutcome> {
    if (!HEAD_SHA_RE.test(job.headSha)) {
      // headSha is interpolated into the sandbox shell script (scriptFor);
      // an unvalidated value must never reach there. Deterministic — no
      // sandbox is created, and both tools report the same reason (P9).
      const outcome = {} as ManagedScanOutcome
      for (const tool of MANAGED_SCAN_TOOLS) {
        outcome[tool] = { kind: 'failed', reason: 'invalid head sha' }
      }
      return outcome
    }
    const token = await getGithubInstallationToken(job.pr.workspaceId)
    let sandbox: RepoSandbox
    try {
      sandbox = await createRepoSandbox({
        repository: job.pr.repo,
        revision: job.headSha,
        token,
        timeoutMs: SANDBOX_TIMEOUT_MS,
        vcpus: SANDBOX_VCPUS,
        image: SANDBOX_IMAGE,
      })
    } catch (error) {
      // Transient by default (retry); the SDK may echo the clone URL.
      throw new Error(scrubToken(message(error), token))
    }
    try {
      const reports: Partial<
        Record<ManagedScanTool, Buffer | { failed: string }>
      > = {}
      for (const tool of MANAGED_SCAN_TOOLS) {
        try {
          reports[tool] = await runTool(
            sandbox,
            tool,
            job.scanId,
            token,
            job.headSha
          )
        } catch (error) {
          throw new Error(scrubToken(message(error), token))
        }
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
      const changedLines = changedLinesOf(addedLinesWithNumbers(diff))
      const outcome = {} as ManagedScanOutcome
      for (const tool of MANAGED_SCAN_TOOLS) {
        const report = reports[tool]
        if (!report || !Buffer.isBuffer(report)) {
          outcome[tool] = {
            kind: 'failed',
            reason: report?.failed ?? `${tool} produced no report`,
          }
          continue
        }
        try {
          const n = normalizeSarif(
            parseSarif(JSON.parse(report.toString('utf8'))),
            { toolHint: tool, changedLines }
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
            `[security-managed-scan] ${logSafe(job.pr.repo)}#${job.pr.number} ${logSafe(tool)}: ${n.findings.length} findings scan=${job.scanId} (dropped notInDiff=${n.dropped.notInDiff} noLocation=${n.dropped.noLocation} dup=${n.dropped.duplicate})`
          )
        } catch (error) {
          // Not JSON / not SARIF 2.1.0 — deterministic, the tool's own failure.
          const reason = scrubToken(message(error), token).slice(0, 500)
          logger.error(
            `[security-managed-scan] ${logSafe(tool)} report unusable scan=${job.scanId}: ${reason.slice(0, 200)}`
          )
          outcome[tool] = { kind: 'failed', reason }
        }
      }
      return outcome
    } finally {
      try {
        await sandbox.stop()
      } catch (error) {
        logger.warn(
          `[security-managed-scan] sandbox stop failed scan=${job.scanId}: ${scrubToken(message(error), token).slice(0, 200)}`
        )
      }
    }
  },
}
