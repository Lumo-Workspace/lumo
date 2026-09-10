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
import type {
  NormalizeOutcome,
  ResolvedPr,
} from './security-sarif-ingest.service'

export const SEMGREP_VERSION = '1.176.1'
export const GITLEAKS_VERSION = '8.30.1'
export const GITLEAKS_URL = `https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz`
export const SEMGREP_CONFIGS = [
  'p/owasp-top-ten',
  'p/typescript',
  'p/nodejs',
  'p/python',
]
export const SANDBOX_IMAGE = 'vercel/sandbox/universal'
export const SANDBOX_VCPUS = 2
/** Below the 800 s Fluid cap of the function that hosts the step. */
export const SANDBOX_TIMEOUT_MS = 12 * 60 * 1000
export const MANAGED_SCAN_TOOLS = ['gitleaks', 'semgrep'] as const
export type ManagedScanTool = (typeof MANAGED_SCAN_TOOLS)[number]

export interface ManagedScanJob {
  scanId: string
  pr: ResolvedPr
  headSha: string
}

export type ManagedScanOutcome = Record<ManagedScanTool, NormalizeOutcome>

/**
 * Kill switch: managed scanning is on unless LUMO_MANAGED_SCAN is exactly "off".
 *
 * The parameter is a plain string map rather than `NodeJS.ProcessEnv`: Next.js
 * augments that type with a required `NODE_ENV`, so a caller (a test) could not
 * pass a bare `{ LUMO_MANAGED_SCAN: 'off' }`. `process.env` is assignable here.
 */
export function isManagedScanEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.LUMO_MANAGED_SCAN !== 'off'
}

/** Every string that leaves this module passes through here (P8). */
export function scrubToken(message: string, token: string): string {
  return token ? message.split(token).join('***') : message
}

const REPORT_PATH: Record<ManagedScanTool, string> = {
  gitleaks: '/tmp/gitleaks.sarif',
  semgrep: '/tmp/semgrep.sarif',
}

const SCRIPT: Record<ManagedScanTool, string> = {
  gitleaks: `set -e; curl -sSL "${GITLEAKS_URL}" | tar -xz -C /tmp gitleaks; /tmp/gitleaks detect --source . --no-git --report-format sarif --report-path ${REPORT_PATH.gitleaks} --exit-code 0 --no-banner`,
  semgrep: `set -e; python3 -m pip install --quiet --break-system-packages semgrep==${SEMGREP_VERSION}; semgrep scan ${SEMGREP_CONFIGS.map(c => `--config ${c}`).join(' ')} --sarif --output ${REPORT_PATH.semgrep} --metrics=off`,
}

/** semgrep exits 1 when it has findings; gitleaks is pinned to --exit-code 0. */
function isSuccessExit(tool: ManagedScanTool, code: number): boolean {
  return tool === 'semgrep' ? code === 0 || code === 1 : code === 0
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function runTool(
  sandbox: RepoSandbox,
  tool: ManagedScanTool,
  scanId: string
): Promise<Buffer | { failed: string }> {
  const result = await sandbox.run('sh', ['-c', SCRIPT[tool]])
  if (!isSuccessExit(tool, result.exitCode)) {
    logger.warn(
      `[security-managed-scan] ${tool} exit ${result.exitCode} scan=${scanId}: ${result.stderr.replace(/[\r\n]+/g, ' ').slice(0, 200)}`
    )
    return { failed: `${tool} exit ${result.exitCode}` }
  }
  const report = await sandbox.readFile(REPORT_PATH[tool])
  if (!report) return { failed: `${tool} produced no report` }
  return report
}

export const securityManagedScanService = {
  async scanRepository(job: ManagedScanJob): Promise<ManagedScanOutcome> {
    const token = await getGithubInstallationToken(job.pr.workspaceId)
    let sandbox: RepoSandbox
    try {
      sandbox = await createRepoSandbox({
        repository: job.pr.repo,
        revision: job.headSha,
        token,
        timeoutMs: SANDBOX_TIMEOUT_MS,
        vcpus: SANDBOX_VCPUS,
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
          reports[tool] = await runTool(sandbox, tool, job.scanId)
        } catch (error) {
          throw new Error(scrubToken(message(error), token))
        }
      }
      const diff = await fetchPrDiff({
        workspaceId: job.pr.workspaceId,
        fullName: job.pr.repo,
        prNumber: job.pr.number,
      })
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
            `[security-managed-scan] ${job.pr.repo}#${job.pr.number} ${tool}: ${n.findings.length} findings scan=${job.scanId} (dropped notInDiff=${n.dropped.notInDiff} noLocation=${n.dropped.noLocation} dup=${n.dropped.duplicate})`
          )
        } catch (error) {
          // Not JSON / not SARIF 2.1.0 — deterministic, the tool's own failure.
          const reason = scrubToken(message(error), token).slice(0, 500)
          logger.error(
            `[security-managed-scan] ${tool} report unusable scan=${job.scanId}: ${reason.slice(0, 200)}`
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
