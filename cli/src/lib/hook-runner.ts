import { readCredentials } from './config'
import { resolveAuthedApiUrl, trimTrailingSlash } from './api'
import { logHookError } from './hook-log'
import { sanitizeField } from './sanitize'
import { readCliVersion } from './cli-version'
import { normalizeAgent } from './agent'
import { extractTaskFromGit, type GitTaskMatch } from './git-task'
import { sumTranscriptUsage } from './transcript-usage'
import { readGitBranch } from './git-branch'
import { resolveBoundProjectId } from './resolve-project'
import { resolveBoundTaskIdentifier } from './resolve-bound-task'
import { autoUpsyncOnDrain } from './memory-auto'
import {
  collectDeletedTestFiles,
  looksLikeDeleteCommand,
} from './git-deleted-test-files'
import {
  CHECKOUT_RELATIVE_PATH_FIELD,
  probeCheckoutRelativePath,
  probeWrittenPathIgnored,
  WRITE_TOOL_NAMES,
  WRITTEN_PATH_IGNORED_FIELD,
  WRITTEN_PATH_PROBE_FIELD,
  WRITTEN_PATH_PROBE_FILE_DIR,
  writtenFilePath,
} from './git-ignored-path'

/**
 * Hard timeout for the hook POST. On timeout the request is aborted,
 * logged, and `runHook` exits 0 — Claude Code is never blocked beyond
 * this ceiling.
 *
 * Sizing history:
 *   - 1000ms (initial): too tight, false timeouts on cold starts
 *   - 1500ms (per plan): still below observed p95 for cold
 *     Next.js + Prisma + Clerk on dev; server actually inserts the row
 *     but the client aborts before reading the 200, so `hook.log` fills
 *     with "This operation was aborted" noise
 *   - 3000ms (now): matches observed p95 on dev; catches the full
 *     happy path without being long enough to make users feel per-tool
 *     hook lag. Revisit when Day 4 makes hook POSTs fire-and-forget so
 *     the client can exit 0 before the server finishes.
 */
const TIMEOUT_MS = 3000

export type HookPath =
  | 'user-prompt-submit'
  | 'pre-tool-use'
  | 'post-tool-use'
  | 'post-tool-use-failure'
  | 'stop'
  | 'stop-failure'
  | 'permission-request'
  | 'permission-denied'
  | 'session-start'
  | 'session-end'
  | 'subagent-start'
  | 'subagent-stop'
  | 'worktree-create'
  | 'worktree-remove'
  | 'file-changed'
  | 'config-change'
  | 'task-created'
  | 'task-completed'
  | 'post-tool-batch'
  | 'user-prompt-expansion'
  | 'notification'
  | 'elicitation'
  | 'elicitation-result'
  | 'cwd-changed'
  | 'instructions-loaded'

/**
 * Read the full hook JSON from stdin.
 *
 * Resolves to an empty string on EOF if no bytes were produced (e.g. tests
 * or a client that invoked the command with no stdin attached). This lets
 * the runner POST `{}` rather than hanging.
 */
function readStdin(): Promise<string> {
  return new Promise(resolve => {
    // If stdin is a TTY (nothing piped in), resolve immediately so the hook
    // doesn't hang when invoked outside of Claude Code.
    if (process.stdin.isTTY) {
      resolve('')
      return
    }
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => {
      data += chunk
    })
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', () => resolve(data))
  })
}

/**
 * Build the array of stdout lines to emit for a given hook path + response
 * body. Returns an empty array for any path that emits nothing.
 *
 * For 'session-start' the array contains:
 *   [0] plain-text bind/unbound status line (always present when taskBinding exists)
 *   [1] (optional) hookSpecificOutput JSON when there is any additionalContext —
 *       the memory section and the PR-review-todos section, concatenated.
 *
 * For 'pre-tool-use' the array contains:
 *   [0] (optional) a PreToolUse hookSpecificOutput JSON carrying the parallel-
 *       edit collision warning (LUM-150 step ③), the one-shot boundary-
 *       crossing reminder (LUM-542), and the one-shot PR security-scan
 *       reminder (LUM-737) as additionalContext, when the server returned any
 *       of `collisionWarning`, `crossingReminder`, `securityReminder`. Empty
 *       otherwise.
 *
 * The JSON lines conform to Claude Code's hookSpecificOutput envelope so the
 * runtime injects additionalContext into the conversation automatically.
 */
export function formatHookStdoutLines(
  path: string,
  responseBody: unknown,
  // Retained for signature stability (callers/tests still pass it). LUM-500
  // removed the only time-dependent rendering (the recovery card), so it is no
  // longer read.
  _now: Date = new Date()
): string[] {
  if (path === 'pre-tool-use') {
    if (responseBody == null || typeof responseBody !== 'object') return []
    const body = responseBody as {
      collisionWarning?: unknown
      crossingReminder?: unknown
      securityReminder?: unknown
    }
    // Three independent PreToolUse signals (LUM-150 collision, LUM-542
    // crossing reminder, LUM-737 security reminder) share one
    // additionalContext block when more than one is present.
    const parts: string[] = []
    if (
      typeof body.collisionWarning === 'string' &&
      body.collisionWarning !== ''
    )
      parts.push(body.collisionWarning)
    if (
      typeof body.crossingReminder === 'string' &&
      body.crossingReminder !== ''
    )
      parts.push(body.crossingReminder)
    if (
      typeof body.securityReminder === 'string' &&
      body.securityReminder !== ''
    )
      parts.push(body.securityReminder)
    if (parts.length === 0) return []
    return [
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          // Server-built text routed back to stdout — sanitize untrusted free
          // text before Claude Code consumes it (ANSI/control-char injection).
          additionalContext: sanitizeField(parts.join('\n\n')),
        },
      }),
    ]
  }
  if (path !== 'session-start') return []
  if (responseBody == null || typeof responseBody !== 'object') return []
  const body = responseBody as SessionStartBody
  if (!body.sessionId) return []
  const lines: string[] = []
  const sessionId = body.sessionId
  const tb = body.taskBinding
  if (tb && tb.bound === true) {
    lines.push(
      `[Lumo] session_id=${sessionId} | Current task: ${tb.taskIdentifier} - ${sanitizeField(tb.taskTitle ?? '')}`
    )
  } else if (tb && tb.bound === false) {
    lines.push(unboundPromptLine(sessionId))
  }
  // Blocker warning + security findings + criteria + progress + memory +
  // linked resources + PR-review todos share one additionalContext block so
  // Claude Code injects a single coherent context payload at session start.
  // The dependency blocker warning (LUM-172) slots in first so it stays
  // prominent — it can preempt the session's work entirely. The undispositioned
  // security findings warning (LUM-737) follows next. Then the
  // progressive-disclosure tiers (LUM-500): Tier-0 acceptance contract →
  // Tier-1 prior-session progress → Tier-2 memory index → linked resources.
  //
  // LUM-500: the prior-session recovery is now the server-rendered Tier-1
  // `progressSection`, which REPLACES the CLI-rendered recovery card so progress
  // isn't injected twice. `body.previousSession` is still sent (it drives the
  // server's lineage/metrics) but is no longer rendered here.
  const envelope = sessionContextEnvelope([
    // LUM-923: a pending workspace deletion outranks everything — the whole
    // workspace, this task included, is about to be gone.
    body.workspaceNoticeSection,
    // Blocker warning first: it can preempt the session's work entirely (wait
    // for the blocker instead of starting) — LUM-172.
    body.blockerWarningSection,
    // LUM-737: undispositioned security findings — second, before the
    // contract: it changes what "done" needs (fix + push, or a human
    // disposition) but unlike a blocker does not preempt the session.
    body.securityFindingsSection,
    // Tier-0 acceptance contract: what the session's work is judged against
    // (LUM-342).
    body.criteriaSection,
    // LUM-807: the test-case nudge follows the contract — same "before the
    // first line of code" moment, and one line long.
    body.testCaseSection,
    // Tier-1 prior-session progress (LUM-500), server-rendered.
    body.progressSection,
    body.memorySection,
    body.linkedResourcesSection,
    body.reviewTodosSection,
    body.layer2ReviewSection,
    // LUM-647: prior-milestone learnings for a resumed STEWARD session. Only the
    // steward branch of the session-start hook populates this; task-bound
    // sessions leave it empty.
    body.stewardMemorySection,
  ])
  if (envelope) lines.push(envelope)
  return lines
}

type PreviousSessionCard = {
  headline: string
  unresolved: string[]
  durationMs: number
  lastActivityAt: string
}

type SessionStartBody = {
  sessionId?: string
  taskBinding?: {
    bound: boolean
    taskIdentifier?: string
    taskTitle?: string
  }
  /** LUM-923: pending workspace deletion notice; absent on older servers. */
  workspaceNoticeSection?: string
  criteriaSection?: string
  /** LUM-807: "## Test cases" nudge; absent on older servers. */
  testCaseSection?: string
  /** LUM-500 Tier-1: server-rendered prior-session progress summary. */
  progressSection?: string
  memorySection?: string
  linkedResourcesSection?: string
  reviewTodosSection?: string
  layer2ReviewSection?: string
  blockerWarningSection?: string
  /** LUM-737: undispositioned security findings on the task's PRs. */
  securityFindingsSection?: string
  /** LUM-647: prior-milestone learnings injected for a resumed STEWARD session. */
  stewardMemorySection?: string
  /**
   * Structured prior-session recovery. Still sent by the server (it drives the
   * lineage SESSION fragment + LUM-402 metrics), but LUM-500 stopped rendering
   * it as a CLI card — `progressSection` is the rendered Tier-1 surface now.
   */
  previousSession?: PreviousSessionCard | null
}

/**
 * The plain-text line shown when a session starts without a bound task and
 * no task could be inferred from local git — the user is asked to name one.
 */
function unboundPromptLine(sessionId: string): string {
  return `[Lumo] session_id=${sessionId} | No task bound. Tell me the task you want to work on (e.g. LUM-42), or say "skip".`
}

/**
 * Wrap any non-empty context parts into a single SessionStart
 * hookSpecificOutput envelope so Claude Code injects one coherent
 * additionalContext payload. Returns null when there is nothing to inject.
 */
function sessionContextEnvelope(
  parts: Array<string | undefined>
): string | null {
  const filled = parts.filter(
    (s): s is string => typeof s === 'string' && s !== ''
  )
  if (filled.length === 0) return null
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: filled.join('\n\n'),
    },
  })
}

/**
 * Dependencies for `resolveSessionStartStdout`, injected so the orchestration
 * can be unit-tested without touching git. The only signal we need is the
 * task inferred from local git; binding is no longer done automatically
 * (LUM-302 — detect-and-suggest, never auto-bind).
 */
export interface SessionStartDeps {
  extractTask: () => GitTaskMatch | null
}

/**
 * The single line printed when a task is inferred from local git at session
 * start. We deliberately do NOT bind — we point the user at the explicit
 * `lumo session attach` so binding stays a confirmed, manual action. The basis
 * (branch name vs recent commit) is shown so the inference is auditable. No
 * task title is available here because nothing was fetched; the title and
 * context surface only once the user actually attaches.
 */
export function formatSuggestLine(
  sessionId: string,
  match: GitTaskMatch
): string {
  const basis = match.source === 'branch' ? 'branch name' : 'recent commits'
  return `[Lumo] session_id=${sessionId} | Detected ${match.identifier} (from ${basis}). Run \`lumo session attach ${match.identifier}\` to bind.`
}

export interface CliIdentity {
  version: string | null
  email?: string | null
  workspaceSlug?: string | null
}

const STATUS_LINE_PREFIX = '[Lumo] session_id='

/**
 * LUM-843: fold the installed CLI version and the logged-in identity into the
 * session-start status line (`[Lumo] session_id=… | lumo 1.70.0 · me@x (ws) |
 * …`). The line only prints after the server accepted this key, so it already
 * proves the CLI is installed and authenticated — carrying version + identity
 * here removes the reason agents ran `lumo --version` / `lumo whoami` first.
 * Only the first status line is touched; the context JSON line is not.
 */
export function withCliIdentity(lines: string[], id: CliIdentity): string[] {
  const first = lines[0]
  if (first === undefined || !first.startsWith(STATUS_LINE_PREFIX)) return lines
  const who = id.email
    ? ` · ${sanitizeField(id.email)}${id.workspaceSlug ? ` (${sanitizeField(id.workspaceSlug)})` : ''}`
    : ''
  const tag = `${id.version ? `lumo ${sanitizeField(id.version)}` : 'lumo'}${who}`
  const cut = first.indexOf(' | ')
  const decorated =
    cut === -1
      ? `${first} | ${tag}`
      : `${first.slice(0, cut)} | ${tag}${first.slice(cut)}`
  return [decorated, ...lines.slice(1)]
}

/**
 * Build the stdout lines for a session-start response. When the server reports
 * the session is already bound, reuse the bound formatting (status line +
 * injected context). When it's unbound, infer the task from local git and — on
 * a hit — print a one-line *suggestion* to run `lumo session attach` (LUM-302:
 * detect-and-suggest, never auto-bind). No match falls back to the generic
 * unbound prompt.
 */
export function resolveSessionStartStdout(
  responseBody: unknown,
  deps: SessionStartDeps,
  // Retained for signature stability; no longer read (see formatHookStdoutLines).
  _now: Date = new Date()
): string[] {
  if (responseBody == null || typeof responseBody !== 'object') return []
  const body = responseBody as SessionStartBody
  if (!body.sessionId) return []
  const sessionId = body.sessionId
  const tb = body.taskBinding

  if (tb && tb.bound === true) {
    return formatHookStdoutLines('session-start', responseBody)
  }
  if (!tb || tb.bound !== false) return []

  const match = deps.extractTask()
  if (!match) return [unboundPromptLine(sessionId)]
  return [formatSuggestLine(sessionId, match)]
}

/**
 * For stop/stop-failure/post-tool-batch hooks, read the transcript named in
 * the payload and fold cumulative token totals into the body under
 * `_lumo_usage` so the server can persist them on the Session. post-tool-batch
 * carries usage so long single turns surface live burn before the first STOP
 * (LUM-345); the server treats it as a flat-columns-only overwrite. Best-
 * effort: returns the body unchanged on any failure (no transcript_path,
 * unreadable, unparseable, no usage). The hook is never blocked or failed by
 * this.
 */
export function augmentBodyWithUsage(path: HookPath, body: string): string {
  if (path !== 'stop' && path !== 'stop-failure' && path !== 'post-tool-batch')
    return body
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(body || '{}')
  } catch {
    return body
  }
  const transcriptPath = parsed['transcript_path']
  if (typeof transcriptPath !== 'string' || !transcriptPath) return body
  const usage = sumTranscriptUsage(transcriptPath)
  if (!usage) return body
  const subEntries = Object.entries(usage.bySubagent)
  return JSON.stringify({
    ...parsed,
    _lumo_usage: {
      ...usage.total,
      byModel: usage.byModel,
      // LUM-932: lets the server split subagent usage out of the parent.
      ...(subEntries.length > 0
        ? {
            bySubagent: Object.fromEntries(
              subEntries.map(([id, u]) => [
                id,
                { ...u.total, byModel: u.byModel },
              ])
            ),
          }
        : {}),
    },
  })
}

/** LUM-932: tag every hook body with the git branch of its `cwd` (identification signal S1, consumed in P2). */
export function augmentBodyWithBranch(body: string): string {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(body || '{}')
  } catch {
    return body
  }
  const cwd = parsed['cwd']
  if (typeof cwd !== 'string' || !cwd) return body
  const branch = readGitBranch(cwd)
  if (!branch) return body
  return JSON.stringify({ ...parsed, _lumo_branch: branch })
}

/**
 * LUM-779: for a post-tool-use Bash event whose command carries an `rm` /
 * `git rm`, ask local git which tracked test files are actually missing now
 * and fold the answer into the body under `_lumo_deleted_test_files`. The
 * server judges TEST_FILE_DELETED by this list — not by the command text —
 * so a restore or an `rm` of an untracked scratch probe is recorded advisory
 * while a real deletion of a tracked test still blocks.
 *
 * The three wire states matter: a non-empty list (blocking), an EMPTY list
 * (probe ran, nothing missing → advisory), and NO field (probe skipped or
 * git could not answer → the server fails closed). So the field is only ever
 * attached when the probe returned an array, and a probe that throws leaves
 * the body untouched. Never blocks or fails the hook.
 */
export function augmentBodyWithDeletedTestFiles(
  path: HookPath,
  body: string,
  probe: typeof collectDeletedTestFiles = collectDeletedTestFiles
): string {
  if (path !== 'post-tool-use') return body
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(body || '{}')
  } catch {
    return body
  }
  if (!parsed || typeof parsed !== 'object') return body
  if (parsed['tool_name'] !== 'Bash') return body
  const input = parsed['tool_input']
  const command =
    input && typeof input === 'object'
      ? (input as Record<string, unknown>)['command']
      : undefined
  if (typeof command !== 'string' || !looksLikeDeleteCommand(command))
    return body
  const cwd =
    typeof parsed['cwd'] === 'string' && parsed['cwd']
      ? (parsed['cwd'] as string)
      : process.cwd()
  let deleted: string[] | null
  try {
    deleted = probe(cwd)
  } catch {
    return body
  }
  if (deleted === null) return body
  return JSON.stringify({ ...parsed, _lumo_deleted_test_files: deleted })
}

/**
 * LUM-893: for a post-tool-use Write/Edit/MultiEdit event, ask local git
 * whether the written `file_path` is gitignored and fold the answer into the
 * body under `_lumo_written_path_ignored`, with the `_lumo_written_path_probe`
 * marker naming the fixed (file-dir) probe (LUM-908). The server records a
 * secret written to an ignored file (never committed) as advisory instead of DONE-blocking.
 *
 * LUM-904: NotebookEdit (`notebook_path`) too, and git's checkout-relative
 * path of the file rides along under `_lumo_checkout_relative_path` — the
 * server judges the test/fixture/doc path downgrade on it instead of the
 * session cwd, which may sit above the checkout.
 *
 * Only a real answer is attached; a probe that cannot answer or throws leaves
 * its field off, and the server then judges as before (fail closed). Never
 * blocks or fails the hook.
 */
export function augmentBodyWithWrittenPathIgnored(
  path: HookPath,
  body: string,
  probe: typeof probeWrittenPathIgnored = probeWrittenPathIgnored,
  rootProbe: typeof probeCheckoutRelativePath = probeCheckoutRelativePath
): string {
  if (path !== 'post-tool-use') return body
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(body || '{}')
  } catch {
    return body
  }
  if (!parsed || typeof parsed !== 'object') return body
  const toolName = parsed['tool_name']
  if (typeof toolName !== 'string' || !WRITE_TOOL_NAMES.has(toolName))
    return body
  const filePath = writtenFilePath(parsed['tool_input'])
  if (filePath === null) return body
  const cwd =
    typeof parsed['cwd'] === 'string' && parsed['cwd']
      ? (parsed['cwd'] as string)
      : process.cwd()
  const answer = <T>(run: () => T | null): T | null => {
    try {
      return run()
    } catch {
      return null
    }
  }
  const ignored = answer(() => probe(cwd, filePath))
  const relPath = answer(() => rootProbe(cwd, filePath))
  if (ignored === null && relPath === null) return body
  // LUM-908: the marker tells the server this answer came from the file's own
  // checkout, so it can trust an "ignored" under `.worktrees/` again.
  return JSON.stringify({
    ...parsed,
    ...(ignored === null
      ? {}
      : {
          [WRITTEN_PATH_IGNORED_FIELD]: ignored,
          [WRITTEN_PATH_PROBE_FIELD]: WRITTEN_PATH_PROBE_FILE_DIR,
        }),
    ...(relPath === null ? {} : { [CHECKOUT_RELATIVE_PATH_FIELD]: relPath }),
  })
}

/**
 * POST the hook body to /api/hooks/<path> with a short timeout. All errors
 * — credential missing, network failure, timeout, non-2xx — are routed to
 * hook.log and then the caller exits 0.
 *
 * This function NEVER throws and NEVER rejects.
 */
export async function runHook(
  path: HookPath,
  agentToken?: string
): Promise<void> {
  const body = await readStdin()
  return runHookWithBody(path, body, agentToken)
}

/**
 * Test-friendly worker. Takes the hook body as an argument so tests can
 * exercise the side-effect logic without poking process.stdin. Production
 * code always goes through `runHook`, which feeds it real stdin.
 */
export async function runHookWithBody(
  path: HookPath,
  body: string,
  agentToken?: string
): Promise<void> {
  try {
    const creds = readCredentials()
    if (!creds) {
      logHookError(`[${path}]`, 'no credentials; skipping')
      return
    }

    // Allow `LUMO_API_URL` to override the baked-in creds.apiUrl for
    // redirecting hooks at dev-env switch without re-running `lumo auth
    // login`. The bearer token from creds.json is still used as-is.
    // An insecure override (non-https, non-localhost) throws here and is
    // caught by the outer try/catch → logged, POST skipped, hook still exits 0.
    // The host-mismatch warning goes to hook.log (never stdout, which would
    // pollute Claude Code).
    const apiUrl = resolveAuthedApiUrl(creds.apiUrl, {
      warn: message => logHookError(`[${path}]`, message),
    })
    const url = `${trimTrailingSlash(apiUrl)}/api/hooks/${path}`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    // Tell the server which coding agent produced this hook. The token is
    // baked into the hook command at `lumo setup --agent <token>`; we send
    // the normalized enum so the server can record it on the session. An
    // unrecognized/absent token is dropped — the server then falls back to
    // its default (CLAUDE_CODE).
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${creds.token}`,
    }
    const agentEnum = agentToken ? normalizeAgent(agentToken) : null
    if (agentEnum) headers['X-Lumo-Agent'] = agentEnum

    const outgoingBody =
      augmentBodyWithBranch(
        augmentBodyWithWrittenPathIgnored(
          path,
          augmentBodyWithDeletedTestFiles(
            path,
            augmentBodyWithUsage(path, body)
          )
        )
      ) || '{}'

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: outgoingBody,
        signal: controller.signal,
      })
      if (!res.ok) {
        logHookError(`[${path}]`, `HTTP ${res.status} from ${url}`)
      } else if (path === 'session-start' || path === 'pre-tool-use') {
        // Paths that turn the response body into stdout for Claude Code:
        //   session-start → bind status + injected context, or (when unbound)
        //                   a LUM-302 suggest line inferred from local git
        //   pre-tool-use  → parallel-edit collision warning (LUM-150 ③)
        // Only after a 2xx so a transient server failure emits nothing.
        try {
          const responseBody = await res.json()
          const lines =
            path === 'session-start'
              ? withCliIdentity(
                  resolveSessionStartStdout(responseBody, {
                    extractTask: () => extractTaskFromGit(),
                  }),
                  {
                    version: readCliVersion(),
                    email: creds.email,
                    workspaceSlug: creds.workspaceSlug,
                  }
                )
              : formatHookStdoutLines(path, responseBody)
          for (const line of lines) {
            process.stdout.write(line + '\n')
          }
        } catch {
          // response body parse failure is non-fatal
        }
      }
    } catch (err) {
      logHookError(`[${path}]`, err)
    } finally {
      clearTimeout(timer)
    }

    // LUM-551: upsync drain on session-wrap-equivalent hooks. The outbox-empty
    // fast path inside autoUpsyncOnDrain means most `stop` events do zero
    // network (and never resolve the project). Best-effort: a failure is
    // logged, never thrown — the hook still exits 0.
    if (
      path === 'session-end' ||
      path === 'stop' ||
      path === 'task-completed'
    ) {
      try {
        await autoUpsyncOnDrain({
          cwd: process.cwd(),
          base: trimTrailingSlash(apiUrl),
          token: creds.token,
          resolveProjectId: async () => {
            const bound = await resolveBoundTaskIdentifier(apiUrl, creds.token)
            if (!bound) return null
            const r = await resolveBoundProjectId(apiUrl, creds.token, bound)
            return r.ok ? r.id : null
          },
        })
      } catch (err) {
        logHookError(`[${path}] upsync`, err)
      }
    }
  } catch (err) {
    logHookError(`[${path}] runner`, err)
  }
}
