import { spawnSync } from 'child_process'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { buildCmdEvidencePointer } from '../../../shared/src/acceptance-evidence'
import { printStatusDigest } from '../lib/status-digest'
import type { CriterionRow } from './task-criteria-list'

export interface VerifyOptions {
  /** Per-checkpointer timeout in seconds (default 600). */
  timeout?: string
  /** LUM-597: required self-report ("我改了 X,因为 Y 可验收") attached to the
   *  verify request; frozen as the AGENT claim when the round passes into
   *  IN_REVIEW. Required whenever a round will be posted. */
  note?: string
}

/** Shape sent to POST /api/tasks/[id]/verify — mirrors machineVerdictInputSchema. */
interface MachineVerdict {
  criterionId: string
  verdict: 'PASS' | 'FAIL'
  evidencePointer?: string
  rejectionReason?: string
  rejectionReasonEnum?: 'CRITERION_UNMET' | 'CHECK_EXECUTION_ERROR'
}

interface RoundOutcome {
  round: number
  maxRounds: number
  allPassed: boolean
  /** LUM-807: one-line test-case reminder; absent on older servers. */
  testCaseNudge?: string | null
  escalated: boolean
  taskStatus: string
  bindingAdvisory?: 'unbound' | 'unconfirmed' | null
  results: Array<{
    criterionId: string
    statement: string
    verdict: 'PASS' | 'FAIL'
  }>
  nextActions: Array<{
    criterionId: string
    statement: string
    checkpointer: string | null
    rejectionReason: string | null
  }>
}

const DEFAULT_TIMEOUT_SECONDS = 600
const OUTPUT_TAIL_CHARS = 1_500
const MAX_OUTPUT_BUFFER = 10 * 1024 * 1024

function tail(s: string, max: number): string {
  return s.length > max ? `…${s.slice(-max)}` : s
}

/**
 * The environment a checkpointer runs in: the CLI's own, minus the flags the
 * CLI folds into process.env for itself. `--no-hints` becomes
 * `LUMO_NO_HINTS=1` (see index.ts preAction) and would otherwise be inherited
 * by e.g. a jest suite that covers the hints block, failing it for a reason
 * unrelated to the criterion (LUM-752).
 */
const CLI_ONLY_ENV = ['LUMO_NO_HINTS'] as const

export function checkpointerEnv(
  base: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const env = { ...base }
  for (const k of CLI_ONLY_ENV) delete env[k]
  return env
}

/**
 * Execute one MACHINE checkpointer in the local repo (runs client-side — the
 * server can't run repo tests) and fold the result into a structured verdict.
 * Exit 0 = PASS with a `cmd:` evidence pointer; non-zero = CRITERION_UNMET;
 * spawn failure or timeout = CHECK_EXECUTION_ERROR.
 */
export function runCheckpointer(
  criterionId: string,
  checkpointer: string,
  timeoutMs: number
): MachineVerdict {
  const r = spawnSync(checkpointer, {
    shell: true,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: MAX_OUTPUT_BUFFER,
    cwd: process.cwd(),
    env: checkpointerEnv(),
  })

  if (r.error) {
    const timedOut =
      (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT' ||
      r.signal === 'SIGTERM'
    return {
      criterionId,
      verdict: 'FAIL',
      rejectionReason: timedOut
        ? `checkpointer timed out after ${Math.round(timeoutMs / 1000)}s: ${checkpointer}`
        : `checkpointer failed to execute: ${r.error.message}`,
      rejectionReasonEnum: 'CHECK_EXECUTION_ERROR',
    }
  }

  const exitCode = r.status ?? 1
  if (exitCode === 0) {
    return {
      criterionId,
      verdict: 'PASS',
      evidencePointer: buildCmdEvidencePointer(checkpointer, 0),
    }
  }

  const output = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.trim()
  return {
    criterionId,
    verdict: 'FAIL',
    evidencePointer: buildCmdEvidencePointer(checkpointer, exitCode),
    rejectionReason: tail(output, OUTPUT_TAIL_CHARS) || `exit code ${exitCode}`,
    rejectionReasonEnum: 'CRITERION_UNMET',
  }
}

/**
 * LUM-819 (E): a machine round only opens on a contract a human confirmed.
 * Returns the stop message, or null when the round may proceed. A criterion
 * with `confirmedAt === undefined` came from an older server that does not
 * report the stamp — unknown, so it never blocks here (the server decides).
 */
export function unconfirmedContractMessage(
  taskId: string,
  criteria: Array<{ confirmedAt?: string | null }>
): string | null {
  const pending = criteria.filter(c => c.confirmedAt === null).length
  if (pending === 0) return null
  return (
    `${taskId}'s acceptance contract has ${pending} unconfirmed ${pending === 1 ? 'criterion' : 'criteria'} — ` +
    `a machine round only opens on a contract a human has confirmed. No checkpointer was run and no round was used.\n` +
    `Ask the user to confirm it: run \`lumo task criteria confirm ${taskId}\` and relay its confirmation envelope. ` +
    `Never add --confirm yourself.\n`
  )
}

/**
 * `lumo verify [task]` — the machine half of the acceptance loop.
 *
 * Runs every MACHINE criterion's checkpointer locally, reports one structured
 * verdict per criterion to the server (the judge: round numbering, the
 * 3-round cap, escalation, and the IN_REVIEW transition all live there), and
 * prints what to do next. Defaults to the session-bound task; an explicit
 * identifier overrides.
 */
export async function verify(
  identifier: string | undefined,
  options: VerifyOptions = {}
): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }
  const base = trimTrailingSlash(resolveAuthedApiUrl(creds.apiUrl))
  const headers: Record<string, string> = {
    Authorization: `Bearer ${creds.token}`,
  }
  const sessionId = process.env.CLAUDE_CODE_SESSION_ID
  if (sessionId) headers['X-Lumo-Session-Id'] = sessionId

  const timeoutSeconds = options.timeout
    ? parseInt(options.timeout, 10)
    : DEFAULT_TIMEOUT_SECONDS
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    console.error('Error: --timeout must be a positive number of seconds.')
    return 1
  }

  // ── Resolve the task: explicit identifier or the session binding ─────────
  let taskId = identifier
  if (!taskId) {
    if (!sessionId) {
      console.error(
        'Error: no task given and $CLAUDE_CODE_SESSION_ID is not set.\n' +
          'Run `lumo verify <LUM-N>` or run inside a Claude Code session bound via `lumo session attach`.'
      )
      return 1
    }
    let res: Response
    try {
      res = await fetch(
        `${base}/api/sessions/${encodeURIComponent(sessionId)}`,
        { headers }
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`Error: could not reach Lumo API (${msg})`)
      return 1
    }
    const data = res.ok
      ? ((await res.json()) as { taskIdentifier: string | null })
      : null
    if (!data?.taskIdentifier) {
      console.error(
        'Error: this session is not bound to a task. Run `lumo session attach <LUM-N>` first, or pass the task explicitly: `lumo verify <LUM-N>`.'
      )
      return 1
    }
    taskId = data.taskIdentifier
  }

  // ── Load the contract and pick out the MACHINE criteria ─────────────────
  let criteriaRes: Response
  try {
    criteriaRes = await fetch(
      `${base}/api/tasks/${encodeURIComponent(taskId)}/criteria`,
      { headers }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API (${msg})`)
    return 1
  }
  if (criteriaRes.status === 401) {
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }
  if (criteriaRes.status === 404) {
    console.error(
      `Error: task ${taskId} not found in workspace ${creds.workspaceSlug}`
    )
    return 1
  }
  if (!criteriaRes.ok) {
    console.error(`Error: could not load criteria (HTTP ${criteriaRes.status})`)
    return 1
  }
  const { criteria } = (await criteriaRes.json()) as {
    criteria: CriterionRow[]
  }
  const machine = criteria.filter(
    c => c.verifierType === 'MACHINE' && c.checkpointer
  )

  if (criteria.length === 0) {
    process.stdout.write(
      `${taskId} has no acceptance contract yet — draft one with \`lumo task criteria set\` before verifying.\n`
    )
    return 1
  }
  if (machine.length === 0) {
    process.stdout.write(
      `${taskId} has no MACHINE criteria — nothing for the machine loop to run.\n` +
        // LUM-789: 未裁定的 HUMAN 项按 tacit pass 处理，除非被人明确送回，
        // 否则不构成"必须交接给人 review"的义务 —— 别再说 hand off。
        `HUMAN criteria pass tacitly unless one is explicitly sent back by a human; ` +
        `no hand-off is required. Move on with \`lumo task update ${taskId} --status in_review\`.\n`
    )
    return
  }

  // ── Contract-confirmation gate (LUM-819) ─────────────────────────────────
  // The server refuses the round anyway (409, no round used); stopping here
  // saves running every checkpointer only to have the result thrown away.
  const gate = unconfirmedContractMessage(taskId, criteria)
  if (gate) {
    process.stdout.write(gate)
    return 1
  }

  // ── Optional self-report (LUM-733) ───────────────────────────────────────
  // `--note` is the agent's one-line self-report. When given it rides with the
  // round and is frozen as the task's claim (source AGENT) on IN_REVIEW; when
  // omitted the round still posts and the claim degrades to the synthesized
  // run summary. It is never a precondition for verifying.
  const note = options.note?.trim() || undefined

  // ── Execute every checkpointer locally ───────────────────────────────────
  process.stdout.write(
    `Verifying ${taskId} — ${machine.length} MACHINE criteria\n`
  )
  const results: MachineVerdict[] = []
  for (const [i, c] of machine.entries()) {
    process.stdout.write(
      `\n[${i + 1}/${machine.length}] ${sanitizeField(c.statement)}\n` +
        `  $ ${sanitizeField(c.checkpointer!)}\n`
    )
    const verdict = runCheckpointer(
      c.id,
      c.checkpointer!,
      timeoutSeconds * 1000
    )
    results.push(verdict)
    if (verdict.verdict === 'PASS') {
      process.stdout.write('  ✓ PASS\n')
    } else {
      process.stdout.write(
        `  ✗ FAIL${verdict.rejectionReason ? ` — ${sanitizeField(tail(verdict.rejectionReason, 400))}` : ''}\n`
      )
    }
  }

  // ── Report the round to the judge ─────────────────────────────────────────
  let res: Response
  try {
    res = await fetch(
      `${base}/api/tasks/${encodeURIComponent(taskId)}/verify`,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ results, note }),
      }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not report the round to Lumo (${msg})`)
    return 1
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: unknown
    } | null
    const detail =
      body && typeof body.error === 'string' ? sanitizeField(body.error) : ''
    console.error(
      `Error: verification round rejected (HTTP ${res.status})${detail ? ` — ${detail}` : ''}`
    )
    return 1
  }

  const outcome = (await res.json()) as RoundOutcome
  const exitCode = reportRound(outcome)
  // LUM-842: the round just changed the task's acceptance state — print where
  // it stands now so the agent does not follow up with `lumo task status`.
  await printStatusDigest(base, creds.token, taskId)
  return exitCode
}

/** Print what the recorded round means; returns the command's exit code. */
function reportRound(outcome: RoundOutcome): number | void {
  process.stdout.write(
    `\nRound ${outcome.round}/${outcome.maxRounds} recorded.\n`
  )

  if (outcome.bindingAdvisory === 'unbound') {
    process.stdout.write(
      '⚠ Working unbound — this verify ran from a Claude Code session not attached to the task. ' +
        'Run `lumo session attach <LUM-N>` to bind (recorded as a boundary crossing).\n'
    )
  } else if (outcome.bindingAdvisory === 'unconfirmed') {
    process.stdout.write(
      '⚠ Could not confirm this session is attached to the task. ' +
        'If you are working with Claude Code, run `lumo session attach <LUM-N>`.\n'
    )
  }

  if (outcome.allPassed) {
    process.stdout.write(
      `✓ All MACHINE criteria passed — task is now ${outcome.taskStatus}.\n` +
        `Stop here: human adjudication (and any HUMAN criteria) take over from this point.\n`
    )
    // LUM-807: advisory, and last — the stop-here line above stays the
    // operative instruction. Server-rendered and only present when the task
    // has a PR but no recorded script.
    if (outcome.testCaseNudge) {
      process.stdout.write(`${sanitizeField(outcome.testCaseNudge)}\n`)
    }
    return
  }

  if (outcome.escalated) {
    process.stdout.write(
      `✗ Round ${outcome.round} still has failures — the machine loop is exhausted (cap ${outcome.maxRounds}).\n` +
        `A human has been notified to take over. STOP retrying lumo verify; fix only what they direct.\n`
    )
    return 1
  }

  process.stdout.write(
    `✗ ${outcome.nextActions.length} criteria unmet — task stays ${outcome.taskStatus}. Next actions:\n`
  )
  for (const a of outcome.nextActions) {
    process.stdout.write(`  • ${sanitizeField(a.statement)}\n`)
    if (a.checkpointer) {
      process.stdout.write(`    check: ${sanitizeField(a.checkpointer)}\n`)
    }
    if (a.rejectionReason) {
      process.stdout.write(
        `    why: ${sanitizeField(tail(a.rejectionReason, 400))}\n`
      )
    }
  }
  process.stdout.write(
    `Fix the failures, then re-run \`lumo verify\` (${outcome.maxRounds - outcome.round} round${outcome.maxRounds - outcome.round === 1 ? '' : 's'} left).\n`
  )
  return 1
}
