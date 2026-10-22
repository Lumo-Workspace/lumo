import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { resolveAuthedApiUrl, trimTrailingSlash } from './api'
import { readCredentials, type Credentials } from './config'
import { acquireFileLock, releaseFileLock } from './file-lock'
import type { LocalFinding, LocalScanner } from './local-scan-report'
import { isMissingPluginRoute } from './plugin-route'
import { codexSessionId } from './session-id'
import { runGit } from './worktree'

/**
 * LUM-1259 — `lumo security scan --log`: report each scanned commit's result
 * to the Lumo server (`POST /api/workspaces/me/security-scan/local-runs`),
 * so a PR whose head matches a logged commit (by sha, or by `git patch-id
 * --stable` after an amend / rebase) shows what was flagged locally. The
 * workspace must have opted in; the server refuses otherwise.
 *
 * What is sent per commit: repo, sha, first parent, patch-id, branch, the
 * agent session id when an agent runs it, scanners and versions, and per
 * finding its fingerprint, rule, severity, file:line, the scanner's redacted
 * title and the server label. Never the evidence line, a raw secret, code or
 * the commit message.
 *
 * Never fatal and never blocking: an upload that cannot go now (no network,
 * not logged in, a server error, a rate limit) is queued under
 * `<git common dir>/lumo/scan-log-queue.json` and flushed by the next
 * `--log` run that reaches the server; `--offline` only queues. A refusal
 * that will not change on a retry drops what it refused: a malformed batch,
 * or every run of a repository the workspace does not have (404). Logging
 * off for the workspace, or a server without the security plugin, drops the
 * whole queue.
 */

export const LOCAL_RUNS_PATH = '/api/workspaces/me/security-scan/local-runs'

/** Runs per upload call (the server's limit). */
export const UPLOAD_BATCH = 50

/** Findings sent per run (the server's limit); the most severe are kept. */
export const UPLOAD_FINDINGS_MAX = 200

/** Runs kept in the offline queue; the oldest go first past this. */
export const QUEUE_MAX = 500

/** Commits one `--log` run records (newest first) — a pre-push range cap. */
export const LOG_COMMITS_MAX = 50

/** Each local scanner's version, as the server names its detectors. */
export const SCANNER_VERSIONS: Record<LocalScanner, string> = {
  SECRETS: 'secrets@1',
  // LUM-1257: fast mode (the lockfile delta against OSV).
  DEPS: 'deps@1',
}

/** How long an upload waits for the server before queueing. */
export const UPLOAD_TIMEOUT_MS = 8000

export type LogTrigger = 'POST_COMMIT' | 'PRE_PUSH' | 'MANUAL'

/** One run as the server takes it (`localScanRunSchema`). */
export interface LocalRunPayload {
  repo: string
  commitSha: string
  parentSha: string | null
  patchId: string | null
  branch: string | null
  sessionId: string | null
  actor: 'USER' | 'AGENT'
  trigger: LogTrigger
  scanners: LocalScanner[]
  scannerVersion: string
  cliVersion: string | null
  filesScanned: number
  findingCount: number
  scannedAt: string
  findings: Array<{
    scanner: LocalScanner
    fingerprint: string
    ruleId: string
    severity: 'LOW' | 'MEDIUM' | 'HIGH'
    filePath: string
    line: number
    title: string
    label: string | null
  }>
}

/** What became of a `--log` run's uploads. */
export interface LogOutcome {
  /** Runs the server accepted now (new + already logged). */
  sent: number
  created: number
  duplicates: number
  /** Runs waiting in the offline queue after this run. */
  queued: number
  /** Queued runs from earlier that this run delivered. */
  flushed: number
  /** Why something was not sent; null when everything went. */
  note: string | null
}

/** A commit's identity as logged: sha, first parent, patch-id. */
export interface CommitFacts {
  sha: string
  parentSha: string | null
  patchId: string | null
}

const RANK = { LOW: 0, MEDIUM: 1, HIGH: 2 } as const

/** The full sha of `ref` as a commit; null when it is not one. */
export function resolveCommit(root: string, ref: string): string | null {
  const r = runGit(
    ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`],
    root
  )
  return r.status === 0 ? r.stdout.trim() : null
}

/** True when `sha` has more than one parent. */
export function isMergeCommit(root: string, sha: string): boolean {
  return (
    runGit(['rev-parse', '--verify', '--quiet', `${sha}^2`], root).status === 0
  )
}

/**
 * `git patch-id --stable` of the commit's diff against its first parent: the
 * same for the change after an amend that keeps the diff, or a rebase that
 * applies cleanly. Null for an empty diff or when git cannot tell.
 */
export function patchIdOf(root: string, sha: string): string | null {
  const diff = spawnSync(
    'git',
    [
      'diff-tree',
      '-p',
      '--root',
      '--no-color',
      '--no-ext-diff',
      '--no-textconv',
      '--no-commit-id',
      sha,
    ],
    { cwd: root, maxBuffer: 512 * 1024 * 1024, timeout: 120_000 }
  )
  if (diff.status !== 0 || !diff.stdout || diff.stdout.length === 0) return null
  const pid = spawnSync('git', ['patch-id', '--stable'], {
    cwd: root,
    input: diff.stdout,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    timeout: 120_000,
  })
  if (pid.status !== 0) return null
  const id = (pid.stdout ?? '').trim().split(/\s+/)[0] ?? ''
  return /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(id) ? id : null
}

export function commitFacts(root: string, sha: string): CommitFacts {
  const parent = runGit(['rev-parse', '--verify', '--quiet', `${sha}^1`], root)
  return {
    sha,
    parentSha: parent.status === 0 ? parent.stdout.trim() : null,
    patchId: patchIdOf(root, sha),
  }
}

/**
 * The non-merge commits in `base..until`, oldest first, at most
 * {@link LOG_COMMITS_MAX} (the newest ones when there are more).
 */
export function commitsInRange(
  root: string,
  base: string,
  until: string
): { shas: string[]; truncated: boolean } {
  const r = runGit(
    [
      'rev-list',
      '--no-merges',
      `--max-count=${LOG_COMMITS_MAX + 1}`,
      `${base}..${until}`,
    ],
    root
  )
  if (r.status !== 0)
    throw new Error((r.stderr || '').trim() || 'git rev-list failed')
  const all = (r.stdout ?? '').split('\n').filter(Boolean)
  return {
    shas: all.slice(0, LOG_COMMITS_MAX).reverse(),
    truncated: all.length > LOG_COMMITS_MAX,
  }
}

/** Who runs this: a coding agent when its session variable is set. */
export function detectActor(
  env: Record<string, string | undefined> = process.env
): { actor: 'USER' | 'AGENT'; sessionId: string | null } {
  const codex = codexSessionId(env)
  if (codex) return { actor: 'AGENT', sessionId: codex }
  const claude = env.CLAUDE_CODE_SESSION_ID
  if (claude) return { actor: 'AGENT', sessionId: claude }
  return { actor: 'USER', sessionId: null }
}

/** One commit's run, findings capped at {@link UPLOAD_FINDINGS_MAX} (most severe kept). */
export function buildRunPayload(input: {
  repo: string
  facts: CommitFacts
  branch: string | null
  trigger: LogTrigger
  scanners: LocalScanner[]
  cliVersion: string | null
  filesScanned: number
  scannedAt: Date
  findings: LocalFinding[]
  env?: Record<string, string | undefined>
}): LocalRunPayload {
  const { actor, sessionId } = detectActor(input.env)
  const kept = [...input.findings]
    .sort((a, b) => RANK[b.severity] - RANK[a.severity])
    .slice(0, UPLOAD_FINDINGS_MAX)
  return {
    repo: input.repo,
    commitSha: input.facts.sha,
    parentSha: input.facts.parentSha,
    patchId: input.facts.patchId,
    branch: input.branch,
    sessionId,
    actor,
    trigger: input.trigger,
    scanners: input.scanners,
    scannerVersion: input.scanners.map(s => SCANNER_VERSIONS[s]).join(';'),
    cliVersion:
      input.cliVersion && /^[\w.+-]{1,50}$/.test(input.cliVersion)
        ? input.cliVersion
        : null,
    filesScanned: input.filesScanned,
    findingCount: input.findings.length,
    scannedAt: input.scannedAt.toISOString(),
    // The scanner already redacted `title`; `evidence` is never sent.
    findings: kept.map(f => ({
      scanner: f.scanner,
      fingerprint: f.fingerprint,
      ruleId: f.ruleId,
      severity: f.severity,
      filePath: f.filePath,
      // A dependency has no line (it is the lockfile's).
      line: f.line ?? 0,
      title: f.title,
      label: f.server?.status ?? null,
    })),
  }
}

// ── offline queue ───────────────────────────────────────────────────────────

/** `<git common dir>/lumo/scan-log-queue.json` (shared by every worktree). */
export function queueFile(root: string): string | null {
  const r = runGit(
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    root
  )
  if (r.status !== 0) return null
  const dir = r.stdout.trim()
  return dir ? path.join(dir, 'lumo', 'scan-log-queue.json') : null
}

function isPayload(v: unknown): v is LocalRunPayload {
  const r = v as LocalRunPayload
  return (
    typeof r === 'object' &&
    r !== null &&
    typeof r.repo === 'string' &&
    typeof r.commitSha === 'string' &&
    Array.isArray(r.findings)
  )
}

export function readQueue(file: string): LocalRunPayload[] {
  try {
    const body = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      runs?: unknown
    }
    return Array.isArray(body.runs) ? body.runs.filter(isPayload) : []
  } catch {
    return []
  }
}

/** Write the queue (the newest {@link QUEUE_MAX}); an empty queue removes the file. */
export function writeQueue(file: string, runs: LocalRunPayload[]): void {
  if (runs.length === 0) {
    fs.rmSync(file, { force: true })
    return
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(
    tmp,
    JSON.stringify({ version: 1, runs: runs.slice(-QUEUE_MAX) }),
    { mode: 0o600 }
  )
  fs.renameSync(tmp, file)
}

/** The same run (commit + result) once; the later copy wins. */
function dedupeRuns(runs: LocalRunPayload[]): LocalRunPayload[] {
  const key = (r: LocalRunPayload) =>
    `${r.repo}\0${r.commitSha}\0${JSON.stringify(r.findings)}`
  const seen = new Map<string, LocalRunPayload>()
  for (const r of runs) {
    seen.delete(key(r))
    seen.set(key(r), r)
  }
  return [...seen.values()]
}

// ── upload ──────────────────────────────────────────────────────────────────

export interface UploadDeps {
  fetch?: typeof fetch
  readCredentials?: () => Credentials | null
  timeoutMs?: number
}

/**
 * One upload call's verdict: accepted; retry later; `drop` — the server
 * refused these runs and would again (a malformed batch, a repository the
 * workspace does not have), so they go but the rest still try; `off` —
 * nothing will be accepted (logging off, no plugin), so everything goes.
 */
export type BatchVerdict =
  | { kind: 'ok'; created: number; duplicates: number }
  | { kind: 'retry'; note: string }
  | { kind: 'drop'; note: string; status: number }
  | { kind: 'off'; note: string }

export async function postBatch(
  runs: LocalRunPayload[],
  deps: UploadDeps = {}
): Promise<BatchVerdict> {
  const creds = (deps.readCredentials ?? readCredentials)()
  if (!creds) return { kind: 'retry', note: 'not logged in (lumo auth login)' }
  let res: Response
  try {
    const apiUrl = resolveAuthedApiUrl(creds.apiUrl, { warn: () => {} })
    res = await (deps.fetch ?? fetch)(
      `${trimTrailingSlash(apiUrl)}${LOCAL_RUNS_PATH}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${creds.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ version: 1, runs }),
        signal: AbortSignal.timeout(deps.timeoutMs ?? UPLOAD_TIMEOUT_MS),
      }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { kind: 'retry', note: `could not reach Lumo (${msg})` }
  }
  if (isMissingPluginRoute(res))
    return {
      kind: 'off',
      note: 'this Lumo server does not log local scans (no security plugin, or an older server)',
    }
  let body: { error?: unknown; code?: unknown; results?: unknown } = {}
  try {
    body = (await res.json()) as typeof body
  } catch {
    // an error page — the status decides
  }
  if (res.ok && Array.isArray(body.results)) {
    const results = body.results as Array<{ status?: unknown }>
    const created = results.filter(r => r.status === 'created').length
    return { kind: 'ok', created, duplicates: results.length - created }
  }
  const error = typeof body.error === 'string' ? body.error : null
  if (res.status === 403 && body.code === 'LOCAL_SCAN_LOG_OFF')
    return {
      kind: 'off',
      note: 'local scan logging is off for this workspace (an OWNER: lumo workspace security-scan update --local-scan-log on)',
    }
  if (res.status === 404 || res.status === 400 || res.status === 413)
    return {
      kind: 'drop',
      status: res.status,
      note: `Lumo refused the upload (HTTP ${res.status}${error ? `: ${error}` : ''})`,
    }
  return {
    kind: 'retry',
    note: `Lumo answered HTTP ${res.status}${error ? ` (${error})` : ''}`,
  }
}

const LOCK_STALE_MS = 60_000

/** How long a run waits for another run's queue lock. */
export const LOCK_WAIT_MS = 2_000

/** Take the queue lock, retrying for up to {@link LOCK_WAIT_MS}. */
function acquireQueueLock(lock: string): boolean {
  const deadline = Date.now() + LOCK_WAIT_MS
  for (;;) {
    if (acquireFileLock(lock, LOCK_STALE_MS)) return true
    if (Date.now() >= deadline) return false
    // A synchronous pause: the hook runs this in the background anyway.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)
  }
}

/**
 * Send `runs` with whatever the queue holds (queue first, oldest first, in
 * batches of {@link UPLOAD_BATCH}). With `offline`, nothing is sent: the runs
 * join the queue. Never throws.
 */
export async function uploadRuns(
  root: string,
  runs: LocalRunPayload[],
  opts: { offline: boolean },
  deps: UploadDeps = {}
): Promise<LogOutcome> {
  const file = queueFile(root)
  const outcome: LogOutcome = {
    sent: 0,
    created: 0,
    duplicates: 0,
    queued: 0,
    flushed: 0,
    note: null,
  }
  const lock = file ? `${file}.lock` : null
  // Another `--log` run holds the queue (post-commit runs can overlap): wait
  // briefly for it. Still held: send this run's own results only, and say
  // that nothing could be queued — never claim a queued run that is not.
  const locked = lock !== null && acquireQueueLock(lock)
  try {
    const queued = file && locked ? readQueue(file) : []
    if (opts.offline) {
      if (!file || !locked) {
        outcome.note = file
          ? '--offline — another lumo run holds the queue, so this result was not queued (rerun --log to record it)'
          : '--offline — no git dir to queue under; nothing recorded'
        return outcome
      }
      const all = dedupeRuns([...queued, ...runs])
      writeQueue(file, all)
      outcome.queued = Math.min(all.length, QUEUE_MAX)
      outcome.note = '--offline — queued, sent by the next --log run online'
      return outcome
    }
    const pending = dedupeRuns([...queued, ...runs])
    const fromQueue = new Set(queued)
    const rest: LocalRunPayload[] = []
    // One repository per call, so a repository the workspace does not have
    // (404) drops only its own runs.
    const byRepo = new Map<string, LocalRunPayload[]>()
    for (const r of pending)
      byRepo.set(r.repo, [...(byRepo.get(r.repo) ?? []), r])
    // send: post; hold: a retryable failure — keep the rest for later;
    // off: nothing will be accepted — the whole queue goes.
    let mode: 'send' | 'hold' | 'off' = 'send'
    for (const repoRuns of byRepo.values()) {
      if (mode === 'off') break
      for (let i = 0; i < repoRuns.length; i += UPLOAD_BATCH) {
        const batch = repoRuns.slice(i, i + UPLOAD_BATCH)
        if (mode === 'hold') {
          rest.push(...batch)
          continue
        }
        const verdict = await postBatch(batch, deps)
        if (verdict.kind === 'ok') {
          outcome.sent += batch.length
          outcome.created += verdict.created
          outcome.duplicates += verdict.duplicates
          outcome.flushed += batch.filter(r => fromQueue.has(r)).length
          continue
        }
        outcome.note = verdict.note
        if (verdict.kind === 'off') {
          rest.length = 0
          mode = 'off'
          break
        }
        if (verdict.kind === 'retry') {
          rest.push(...batch)
          mode = 'hold'
          continue
        }
        // drop: these runs go; a 404 (repository not in the workspace)
        // takes the repository's other runs with them.
        if (verdict.status === 404) break
      }
    }
    if (file && locked) {
      writeQueue(file, rest)
      outcome.queued = Math.min(rest.length, QUEUE_MAX)
    } else if (rest.length > 0) {
      outcome.note = `${outcome.note ?? 'not sent'}; another lumo run holds the queue — not queued`
    }
    return outcome
  } catch (err) {
    outcome.note = `queue: ${err instanceof Error ? err.message : String(err)}`
    return outcome
  } finally {
    if (lock && locked) releaseFileLock(lock)
  }
}
