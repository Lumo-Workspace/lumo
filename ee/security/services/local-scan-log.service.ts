/**
 * LUM-1259 — the local scan log: the results `lumo security scan --log`
 * (the post-commit and pre-push hooks) reports for each commit, kept so a
 * PR whose head matches a logged commit — by sha, or by `git patch-id` after
 * an amend or a rebase — can show what was flagged locally before the push.
 *
 * Opt-in per workspace (`securityLocalScanLogEnabled`, default off): the
 * metadata of commits nobody pushed yet is sensitive. Client-reported, so
 * every run is LOCAL: nothing proves a clean scan happened, and nothing
 * here blocks or clears DONE (that stays the PR scan).
 *
 * What is stored: repo, sha, parent, patch-id, branch, actor, versions and
 * per finding its fingerprint, rule, file:line, the scanner's redacted title
 * (redacted again here) and its server label. Never code, evidence, a raw
 * secret or a commit message — the validator strips any other field.
 *
 * Layering: service — the database through repositories.
 */
import { createHash } from 'node:crypto'
import { logger } from '@/lib/logger'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { createSlidingWindowRateLimiter } from '@/lib/services/sliding-window-rate-limit'
import { redactPromptLine } from '@/lib/security-scan/inject-guard'
import { sanitizeField } from '@/lib/utils/sanitize'
import { securityColumnsRepository } from '@/ee/security/repositories/security-columns.repository'
import {
  localScanLogRepository,
  type LocalScanActor,
  type LocalScanFindingRow,
  type LocalScanRunRow,
  type LocalScanSeverity,
  type LocalScanTrigger,
} from '@/ee/security/repositories/local-scan-log.repository'
import {
  LOCAL_SCAN_TITLE_MAX,
  type LocalScanFindingInput,
  type LocalScanRunInput,
  type LocalScanUpload,
} from '@/ee/security/validation/local-scan-log'

/** Upload calls per member per minute (each carries up to 50 runs). */
export const LOCAL_SCAN_LOG_RATE_LIMIT = { max: 30, windowMs: 60_000 }

/** Runs a PR read-out shows of a head's local history. */
export const LOCAL_HISTORY_RUNS = 20

/** The error code a refused upload carries when the workspace is opted out. */
export const LOCAL_SCAN_LOG_OFF = 'LOCAL_SCAN_LOG_OFF'

const limiter = createSlidingWindowRateLimiter({
  prefix: 'local-scan-log:rate',
  max: LOCAL_SCAN_LOG_RATE_LIMIT.max,
  windowMs: LOCAL_SCAN_LOG_RATE_LIMIT.windowMs,
  logTag: 'local-scan-log-rate-limit',
})

export async function checkLocalScanLogRateLimit(key: string): Promise<void> {
  if (!(await limiter.check(key))) {
    throw Object.assign(
      new Error(
        `Rate limit exceeded (${LOCAL_SCAN_LOG_RATE_LIMIT.max} req/min)`
      ),
      { status: 429 }
    )
  }
}

/** Test-only: reset module-level state between test cases. */
export function __resetLocalScanLogRateLimitForTests(): void {
  limiter.reset()
}

/** Who uploads: the API key's member in its workspace. */
export interface LocalScanLogCaller {
  workspaceId: string
  memberId: string
}

export interface LocalScanUploadResult {
  version: 1
  results: Array<{
    commitSha: string
    /** `created`, or `duplicate` when an identical run was already logged. */
    status: 'created' | 'duplicate'
  }>
}

/** A title as stored: one line, credentials redacted, capped. */
export function cleanTitle(title: string): string {
  const text = redactPromptLine(sanitizeField(title)).text
  return text.length > LOCAL_SCAN_TITLE_MAX
    ? `${text.slice(0, LOCAL_SCAN_TITLE_MAX)}…`
    : text
}

function cleanFinding(f: LocalScanFindingInput): LocalScanFindingRow {
  return {
    scanner: f.scanner,
    fingerprint: f.fingerprint,
    ruleId: sanitizeField(f.ruleId),
    severity: f.severity,
    filePath: sanitizeField(f.filePath),
    line: f.line,
    title: cleanTitle(f.title),
    label: f.label,
  }
}

/**
 * What makes two uploads of one commit "the same run": the scanners, their
 * version and the findings (fingerprint, rule, position, label), in a fixed
 * order. Titles, times and the trigger are left out, so a pre-push rerun of
 * a commit the post-commit hook already logged is a duplicate.
 */
export function resultKeyOf(
  run: Pick<LocalScanRunInput, 'scanners' | 'scannerVersion' | 'findingCount'>,
  findings: LocalScanFindingRow[]
): string {
  const rows = findings
    .map(f => [f.scanner, f.fingerprint, f.ruleId, f.filePath, f.line, f.label])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  return createHash('sha256')
    .update(
      JSON.stringify([
        [...run.scanners].sort(),
        run.scannerVersion,
        run.findingCount,
        rows,
      ])
    )
    .digest('hex')
}

/** The task a session of this member is bound to; nulls for any other id. */
async function sessionBinding(
  sessionId: string | null,
  memberId: string
): Promise<{ sessionId: string | null; taskId: string | null }> {
  if (!sessionId) return { sessionId: null, taskId: null }
  const row = await sessionRepository.findForMemberWithBinding(
    sessionId,
    memberId
  )
  if (!row) return { sessionId: null, taskId: null }
  return { sessionId: row.id, taskId: row.task?.id ?? null }
}

/** One logged run as a PR read-out shows it (always labelled LOCAL). */
export interface LocalRunView {
  commitSha: string
  /** `sha`: the PR head itself; `patch-id`: the same change before an amend / rebase. */
  matchedBy: 'sha' | 'patch-id'
  branch: string | null
  actor: LocalScanActor
  trigger: LocalScanTrigger
  scanners: string[]
  scannedAt: string
  findingCount: number
  findings: Array<{
    scanner: string
    fingerprint: string
    ruleId: string
    severity: LocalScanSeverity
    filePath: string
    line: number
    title: string
    label: string | null
  }>
}

/**
 * LUM-1259 — a PR head's local history: what the CLI logged for that commit
 * or for the same change under another sha. `flaggedAt` = the commits whose
 * latest logged run had findings — "flagged locally at <sha> and pushed
 * anyway". Never part of the DONE gate.
 */
export interface LocalHistoryView {
  source: 'LOCAL'
  headSha: string
  runs: LocalRunView[]
  flaggedAt: string[]
}

export function toLocalHistory(
  headSha: string,
  rows: LocalScanRunRow[]
): LocalHistoryView | null {
  if (rows.length === 0) return null
  const runs: LocalRunView[] = rows.map(r => ({
    commitSha: r.commitSha,
    matchedBy: r.commitSha === headSha ? 'sha' : 'patch-id',
    branch: r.branch === null ? null : sanitizeField(r.branch),
    actor: r.actor,
    trigger: r.trigger,
    scanners: r.scanners,
    scannedAt: r.scannedAt.toISOString(),
    findingCount: r.findingCount,
    findings: r.findings.map(f => ({ ...f, title: cleanTitle(f.title) })),
  }))
  // Rows come newest first: the first run seen per commit is its latest.
  const latest = new Map<string, LocalRunView>()
  for (const run of runs)
    if (!latest.has(run.commitSha)) latest.set(run.commitSha, run)
  const flaggedAt = [...latest.values()]
    .filter(r => r.findingCount > 0)
    .map(r => r.commitSha)
  return { source: 'LOCAL', headSha, runs, flaggedAt }
}

/** A run's unique key (repo, commit, result) as one string. */
function runIdentity(r: {
  repo: string
  commitSha: string
  resultKey: string
}): string {
  return `${r.repo}\0${r.commitSha}\0${r.resultKey}`
}

export const localScanLogService = {
  /**
   * Record the uploaded runs. 403 (`LOCAL_SCAN_LOG_OFF`) when the workspace
   * has not opted in, 404 when a run's repository is not linked to it.
   * Identical reruns of a commit are reported as duplicates, not stored.
   */
  async record(
    caller: LocalScanLogCaller,
    upload: LocalScanUpload
  ): Promise<LocalScanUploadResult> {
    const enabled = await securityColumnsRepository.findLocalScanLogEnabled(
      caller.workspaceId
    )
    if (!enabled) {
      throw Object.assign(
        new Error(
          'Local scan logging is off for this workspace — an OWNER turns it on with `lumo workspace security-scan update --local-scan-log on --confirm`'
        ),
        { status: 403, code: LOCAL_SCAN_LOG_OFF }
      )
    }

    const repos = new Map<string, string>()
    for (const repo of new Set(upload.runs.map(r => r.repo))) {
      const linked = await localScanLogRepository.findLinkedRepo(
        caller.workspaceId,
        repo
      )
      if (!linked) {
        throw Object.assign(
          new Error(`Repository ${repo} is not linked to this workspace`),
          { status: 404 }
        )
      }
      repos.set(repo, linked)
    }

    const bindings = new Map<
      string,
      Awaited<ReturnType<typeof sessionBinding>>
    >()
    const results: LocalScanUploadResult['results'] = []
    const prepared = upload.runs.map(run => {
      const findings = run.findings.map(cleanFinding)
      return {
        run,
        findings,
        repo: repos.get(run.repo) as string,
        resultKey: resultKeyOf(run, findings),
      }
    })
    // One dedupe read for the whole upload; a run repeated within it is a
    // duplicate of its first copy.
    const stored = await localScanLogRepository.findExistingRuns(
      caller.workspaceId,
      prepared.map(p => ({
        repo: p.repo,
        commitSha: p.run.commitSha,
        resultKey: p.resultKey,
      }))
    )
    const seen = new Set(stored.map(runIdentity))
    for (const { run, findings, repo, resultKey } of prepared) {
      const identity = runIdentity({
        repo,
        commitSha: run.commitSha,
        resultKey,
      })
      if (seen.has(identity)) {
        results.push({ commitSha: run.commitSha, status: 'duplicate' })
        continue
      }
      seen.add(identity)
      const key = run.sessionId ?? ''
      if (!bindings.has(key))
        bindings.set(key, await sessionBinding(run.sessionId, caller.memberId))
      const binding = bindings.get(key) as Awaited<
        ReturnType<typeof sessionBinding>
      >
      const created = await localScanLogRepository.create({
        workspaceId: caller.workspaceId,
        repo,
        commitSha: run.commitSha,
        parentSha: run.parentSha,
        patchId: run.patchId,
        branch: run.branch === null ? null : sanitizeField(run.branch),
        sessionId: binding.sessionId,
        taskId: binding.taskId,
        actor: run.actor,
        memberId: caller.memberId,
        trigger: run.trigger,
        scanners: run.scanners,
        scannerVersion: run.scannerVersion,
        cliVersion: run.cliVersion,
        filesScanned: run.filesScanned,
        findingCount: run.findingCount,
        resultKey,
        scannedAt: new Date(run.scannedAt),
        findings,
      })
      results.push({
        commitSha: run.commitSha,
        status: created ? 'created' : 'duplicate',
      })
    }
    return { version: 1, results }
  },

  /**
   * A PR head's local history (null when nothing matches). Advisory: a
   * failed read is logged and reads as none, so it never breaks the PR
   * scan read-out it rides on.
   */
  async historyForHead(
    workspaceId: string,
    repo: string,
    headSha: string | null
  ): Promise<LocalHistoryView | null> {
    if (!headSha) return null
    try {
      const spellings = await localScanLogRepository.findRepoSpellings(
        workspaceId,
        repo
      )
      const rows = await localScanLogRepository.findHistoryForCommit(
        workspaceId,
        spellings,
        headSha,
        LOCAL_HISTORY_RUNS
      )
      return toLocalHistory(headSha, rows)
    } catch (err) {
      logger.warn('[local-scan-log] local history read failed', {
        error: err instanceof Error ? err.message : String(err),
      })
      return null
    }
  },
}
