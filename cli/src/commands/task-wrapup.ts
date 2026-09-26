import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveBoundTaskIdentifier } from '../lib/resolve-bound-task'
import { sanitizeField } from '../lib/sanitize'
import { shellQuote } from '../lib/confirmation'
import {
  fetchOpenCrossings,
  dispositionUrl,
  type OpenCrossing,
  type OpenCrossingsResult,
} from '../lib/open-crossings'
import {
  describeWorktreeCleanup,
  mergedHeadShasOf,
  planTaskWorktreeCleanup,
  type CleanupItem,
} from '../lib/worktree-cleanup'
import {
  contractSettledLine,
  pushSecurityActions,
  pushSecurityCoverage,
  pushTestCaseActions,
  pushTestCaseVerdictActions,
  SECURITY_HINT,
  splitNextActions,
  type TaskStatusResponse,
} from './task-status'
import { describeDoneTransition, type LinkedPr } from './task-update'

/**
 * `lumo task wrapup [task]` (LUM-841) — the whole wrap-up in one read.
 *
 * Wrapping a task up used to take 5–8 separate lumo calls late in a session
 * (`task status`, `pr scan`, `testcase list`, a crossing read per crossing,
 * `task update --status done` just to see its envelope, `worktree list`), and
 * every one of them is a full model step over a 300K+ context. This command
 * does the same reads in one process and prints them in the order the
 * wrap-up actually walks: contract & verification → test cases → security
 * scans → boundary crossings → DONE.
 *
 * It is strictly read-only: GET requests plus local `git` inspection. It
 * never runs a verify round, never requests a disposition read receipt, and
 * never changes a status. The human gates stay where they are — every
 * approval it mentions is something the agent relays to the user, and the
 * only approval-flagged command it prints is the DONE envelope's own
 * confirmCommand, shown only when nothing is left and labelled as the user's.
 */

export type Read<T> = { ok: true; value: T } | { ok: false; reason: string }

export interface WrapupTask {
  identifier: string
  title: string
  status: string
  /** Absent on older servers — treated as "none linked". */
  pullRequests?: LinkedPr[]
}

export interface WrapupInput {
  identifier: string
  status: Read<TaskStatusResponse>
  task: Read<WrapupTask>
  crossings: OpenCrossingsResult
  /** Local worktree assessment; `null` = not a git checkout / could not tell. */
  worktrees: { mainRoot: string; items: CleanupItem[] } | null
  dispositionUrl: string
}

export type Readiness =
  | { level: 'DONE'; reasons: string[] }
  | { level: 'UNCONFIRMED'; reasons: string[] }
  | { level: 'BLOCKED'; reasons: string[] }
  | { level: 'NOT_YET'; reasons: string[] }
  | { level: 'READY'; reasons: string[] }

const STATEMENT_CAP = 90
const REASON_CAP = 240

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}

function oneLine(s: string): string {
  return sanitizeField(s).replace(/\s+/g, ' ').trim()
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * Where the task stands relative to DONE. Mirrors the server gate
 * (`lib/acceptance/done-verdict.ts`) for what BLOCKS — a send-back, a
 * blocking crossing, a blocking security finding, a proven test-case defect —
 * and adds the agent-side "not yet" conditions the gate does not check
 * (never verified, unmet criteria, unmerged PRs). Fails closed: any failed
 * read makes the verdict UNCONFIRMED, never READY.
 */
export function assessReadiness(input: WrapupInput): Readiness {
  const unconfirmed: string[] = []
  if (!input.status.ok)
    unconfirmed.push(`acceptance status (${input.status.reason})`)
  if (!input.task.ok) unconfirmed.push(`task / PRs (${input.task.reason})`)
  if (input.crossings.status === 'error')
    unconfirmed.push(`boundary crossings (${input.crossings.reason})`)
  if (
    input.status.ok &&
    input.status.value.securityFindings === null // the server's own fail-closed marker
  )
    unconfirmed.push('security findings')

  const taskStatus = input.task.ok
    ? input.task.value.status
    : input.status.ok
      ? input.status.value.task.status
      : null
  if (taskStatus === 'DONE') {
    return { level: 'DONE', reasons: ['The task is already DONE.'] }
  }

  if (unconfirmed.length > 0) {
    return {
      level: 'UNCONFIRMED',
      reasons: unconfirmed.map(u => `could not read ${u}`),
    }
  }

  const status = (input.status as { ok: true; value: TaskStatusResponse }).value
  const task = (input.task as { ok: true; value: WrapupTask }).value
  const crossings = (
    input.crossings as Extract<OpenCrossingsResult, { status: 'ok' }>
  ).crossings
  const split = splitNextActions(status.nextActions)

  const blocked: string[] = []
  const sendBacks = status.criteria.filter(
    c => c.latestVerdict?.verdict === 'FAIL'
  )
  if (sendBacks.length > 0)
    blocked.push(`${plural(sendBacks.length, 'send-back')} (criterion FAIL)`)
  const blockingCrossings = crossings.filter(c => c.blocking)
  if (blockingCrossings.length > 0)
    blocked.push(
      `${plural(blockingCrossings.length, 'undispositioned boundary crossing')} — the user rules on each`
    )
  const blockingFindings = split.security.filter(a => a.blocking)
  if (blockingFindings.length > 0)
    blocked.push(
      `${plural(blockingFindings.length, 'blocking security finding')} — fix and push, or a human dispositions it on the web`
    )
  const defects = split.testCaseVerdict.filter(
    a => a.signal === 'PROVEN_DEFECT'
  )
  if (defects.length > 0)
    blocked.push(
      `${plural(defects.length, 'test case')} with a proven defect — blocks DONE unless a human already dispositioned that run`
    )
  if (blocked.length > 0) return { level: 'BLOCKED', reasons: blocked }

  const notYet: string[] = []
  if (status.escalated)
    notYet.push('escalated — the machine loop is exhausted; wait for a human')
  if (status.criteria.length === 0) notYet.push('no acceptance contract')
  if (status.currentRound === 0 && status.criteria.length > 0)
    notYet.push('lumo verify has not run')
  else if (split.criteria.length > 0)
    notYet.push(
      `${plural(split.criteria.length, 'unmet criterion', 'unmet criteria')}`
    )
  const { unmerged } = partitionPrs(task.pullRequests ?? [])
  if (unmerged.length > 0)
    notYet.push(
      `${plural(unmerged.length, 'linked PR')} not merged (${unmerged
        .map(p => `#${p.number} ${p.state ?? 'unknown'}`)
        .join(', ')})`
    )
  if (notYet.length > 0) return { level: 'NOT_YET', reasons: notYet }

  return {
    level: 'READY',
    reasons: ['Nothing blocks DONE and nothing is left on the agent side.'],
  }
}

function partitionPrs(prs: LinkedPr[]): { unmerged: LinkedPr[] } {
  return { unmerged: prs.filter(p => p.state !== 'merged') }
}

function header(n: number, title: string): string {
  return `\n[${n}/5] ${title}`
}

function pushContract(lines: string[], input: WrapupInput): void {
  lines.push(header(1, 'Contract & verification'))
  if (!input.status.ok) {
    lines.push(
      `  ⚠ Could not read the acceptance status (${sanitizeField(input.status.reason)}) — contract, verification, test cases and security scans are unconfirmed.`
    )
    return
  }
  const data = input.status.value
  const id = data.task.identifier
  if (data.criteria.length === 0) {
    lines.push(
      `  No acceptance criteria — draft them: lumo task criteria set ${id} --file <criteria.json>`
    )
    return
  }
  const unconfirmed =
    data.task.status === 'DONE'
      ? 0
      : data.criteria.filter(c => c.confirmedAt == null).length
  if (unconfirmed > 0) {
    lines.push(
      `  Contract unconfirmed (${unconfirmed} of ${data.criteria.length}) — relay \`lumo task criteria confirm ${id}\` (exit-4 envelope; the user approves). lumo verify refuses an unconfirmed contract.`
    )
  }
  if (data.escalated) {
    lines.push(
      '  ⚠ Escalated: the machine loop is exhausted — a human has been paged. Stop retrying lumo verify.'
    )
  }
  const { criteria: unmet } = splitNextActions(data.nextActions)
  lines.push(
    `  Criteria: ${data.criteria.length} total, ${unmet.length} unmet · ${
      data.currentRound === 0
        ? 'no verification rounds yet'
        : `round ${data.currentRound}/${data.maxRounds}`
    }`
  )
  const byId = new Map(data.criteria.map(c => [c.id, c]))
  for (const a of unmet) {
    const failed = byId.get(a.criterionId)?.latestVerdict?.verdict === 'FAIL'
    lines.push(
      `    ${failed ? '✗' : '○'} ${a.criterionId}  [${a.verifierType}]  ${sanitizeField(clip(a.statement, STATEMENT_CAP))}`
    )
    if (a.rejectionReason) {
      lines.push(`        why: ${oneLine(clip(a.rejectionReason, REASON_CAP))}`)
    }
  }
  const stale = data.criteria.filter(
    c => c.latestVerdict != null && (c.verdictStale || c.checkMismatch)
  ).length
  if (stale > 0) {
    lines.push(
      `  ⚠ ${plural(stale, 'pass', 'passes')} predate a criterion edit — re-run lumo verify ${id} to re-confirm.`
    )
  }
  const left = data.maxRounds - data.currentRound
  if (data.escalated) {
    lines.push('  → Wait for human direction.')
  } else if (data.currentRound === 0) {
    lines.push(
      `  → Not verified yet: run \`lumo verify ${id}\` (${plural(data.maxRounds, 'round')} available).`
    )
  } else if (unmet.some(a => a.verifierType === 'MACHINE')) {
    lines.push(
      `  → Fix the unmet criteria, then run \`lumo verify ${id}\` (${plural(left, 'round')} left).`
    )
  } else if (unmet.length > 0) {
    lines.push(
      `  → Sent back by a human — address the reasons above, then run \`lumo verify ${id}\`.`
    )
  } else {
    lines.push(`  ✓ ${contractSettledLine(data.criteria)}`)
  }
}

function pushTestCases(lines: string[], input: WrapupInput): void {
  lines.push(header(2, 'Test cases'))
  if (!input.status.ok) {
    lines.push('  ⚠ Unconfirmed — the acceptance status could not be read.')
    return
  }
  const split = splitNextActions(input.status.value.nextActions)
  const body: string[] = []
  pushTestCaseVerdictActions(body, split.testCaseVerdict)
  const id = input.status.value.task.identifier
  for (const d of split.testCaseVerdict) {
    if (d.signal !== 'PROVEN_DEFECT') continue
    body.push(
      `    blocks DONE until the user rules on that run → lumo task testcase disposition ${id}/TC${d.number} --known-defect  |  --not-a-defect`
    )
  }
  pushTestCaseActions(body, split.testCase)
  // One line, not one per criterion: `task status` lists them; here the
  // count and the command are what the wrap-up needs (the report is read at
  // the end of a long session — every line is paid for at that context).
  const gaps = split.coverageGap
  if (gaps.length > 0) {
    body.push(
      `  Not yet covered by a test case: ${gaps.length} of ${input.status.value.criteria.length} criteria — advisory, never blocks DONE`
    )
    body.push(`    cover one: ${sanitizeField(gaps[0]!.command)}`)
  }
  if (body.length === 0) {
    lines.push('  No test-case signals.')
    return
  }
  for (const l of body)
    if (l !== '') lines.push(l.startsWith(' ') ? l : `  ${l}`)
}

function pushSecurity(lines: string[], input: WrapupInput): void {
  lines.push(header(3, 'Security scans'))
  if (!input.status.ok) {
    lines.push('  ⚠ Unconfirmed — the acceptance status could not be read.')
    return
  }
  const data = input.status.value
  const { security } = splitNextActions(data.nextActions)
  const body: string[] = []
  pushSecurityActions(body, security)
  pushSecurityCoverage(body, data)
  if (body.length === 0) {
    lines.push('  No linked PR scans and no open findings.')
    return
  }
  for (const l of body) lines.push(l.startsWith(' ') ? l : `  ${l}`)
  if (security.length > 0) lines.push(`  ${SECURITY_HINT}`)
}

function crossingCommand(id: string, task: string, ruling: string): string {
  return `lumo crossing disposition ${shellQuote(id)} ${ruling} --task ${shellQuote(task)}`
}

function pushCrossing(lines: string[], c: OpenCrossing, task: string): void {
  const gate = c.blocking
    ? 'blocks DONE'
    : c.advisory
      ? `advisory — does not block DONE${c.rejudge ? `; re-judged: ${oneLine(c.rejudge)}` : ''}`
      : 'below the workspace gate — does not block DONE'
  lines.push(
    `  ${c.blocking ? '•' : '◦'} ${sanitizeField(c.id)}  [${c.severity}] ${sanitizeField(c.category)} (${gate})`
  )
  const detail = oneLine(c.detail)
  if (detail) lines.push(`      detail: ${clip(detail, 400)}`)
  const seen = c.occurrenceCount ?? 1
  if (seen > 1) lines.push(`      seen ×${seen} while open`)
  if (c.reversible === false)
    lines.push(
      '      ⚠ irreversible category — the action reached outside the repo'
    )
  const explanations = c.explanations ?? []
  if (explanations.length === 0 && c.blocking) {
    lines.push(
      `      agent explanation: none — add one first: lumo crossing explain ${shellQuote(c.id)} --note "…" (append-only; clears nothing)`
    )
  } else if (explanations.length > 0) {
    lines.push(
      `      agent explanations (${explanations.length}, self-report · unverified):`
    )
    for (const e of explanations) {
      lines.push(`        - ${clip(oneLine(e), 300)}`)
    }
  }
  lines.push(
    `      the user rules → ${crossingCommand(c.id, task, '--false-positive')}  |  ${crossingCommand(c.id, task, '--confirmed')}`
  )
}

function pushCrossings(lines: string[], input: WrapupInput): void {
  lines.push(header(4, 'Boundary crossings'))
  const result = input.crossings
  if (result.status === 'error') {
    lines.push(
      `  ⚠ Boundary-crossing check failed (${sanitizeField(result.reason)}) — could not confirm whether any are undispositioned.`
    )
    return
  }
  if (result.crossings.length === 0) {
    lines.push('  No undispositioned crossings.')
    return
  }
  const blocking = result.crossings.filter(c => c.blocking).length
  lines.push(
    `  ${result.crossings.length} undispositioned: ${blocking} blocking DONE, ${result.crossings.length - blocking} advisory / non-blocking.`
  )
  lines.push(
    '  Relay each one to the user as shown below. Once they pick a ruling, run that command: it walks the server-enforced read → ruling handshake, one exit-4 envelope per step — relay each and add a step flag only after the user approves that step.'
  )
  for (const c of result.crossings) pushCrossing(lines, c, input.identifier)
  lines.push(`  Web panel: ${input.dispositionUrl}`)
}

function pushDone(lines: string[], input: WrapupInput, r: Readiness): void {
  lines.push(header(5, 'DONE'))
  const label: Record<Readiness['level'], string> = {
    DONE: 'DONE — already closed',
    UNCONFIRMED:
      'CANNOT CONFIRM — a read failed; do not assume anything is clear',
    BLOCKED: 'BLOCKED — a human-only gate would refuse DONE',
    NOT_YET: 'NOT YET — work is left before asking for DONE',
    READY: 'READY — relay the DONE envelope below to the user',
  }
  lines.push(`  Readiness: ${label[r.level]}`)
  for (const reason of r.reasons) lines.push(`    - ${sanitizeField(reason)}`)

  // What moving to DONE would change — the same lines `task update --status
  // done` puts in its envelope, so the user can be shown it from here.
  const change: string[] = []
  if (input.task.ok) {
    if (r.level !== 'DONE')
      change.push(
        ...describeDoneTransition(
          input.task.value,
          input.task.value.pullRequests ?? []
        )
      )
    else {
      const prs = input.task.value.pullRequests ?? []
      if (prs.length > 0)
        change.push(...describeDoneTransition(input.task.value, prs).slice(2))
    }
  } else {
    change.push(
      `⚠ Could not read the task and its linked PRs (${sanitizeField(input.task.reason)})`
    )
  }
  if (input.worktrees === null) {
    change.push('⚠ Could not assess local worktrees (not a git checkout?)')
  } else if (input.worktrees.items.length === 0) {
    change.push(`No local worktrees for ${input.identifier}`)
  } else {
    change.push(
      ...describeWorktreeCleanup(
        input.worktrees.items,
        input.worktrees.mainRoot
      )
    )
  }
  lines.push(r.level === 'DONE' ? '  Now:' : '  Moving to DONE would:')
  for (const c of change) lines.push(`    ${c}`)

  if (r.level === 'READY') {
    const inside = input.worktrees?.items.some(i => i.reason === 'cwd')
    lines.push(
      `  Show the user the lines above. Only after they approve, run: lumo task update ${input.identifier} --status done --confirm`
    )
    if (inside && input.worktrees) {
      lines.push(
        `    (run it from ${input.worktrees.mainRoot} — the current directory is inside this task's worktree, which blocks its removal)`
      )
    }
  } else if (r.level !== 'DONE') {
    lines.push(
      `  Clear the items above, then run \`lumo task wrapup ${input.identifier}\` again.`
    )
  }
}

/** Render the whole report. Pure — every input is already read. */
export function formatWrapup(input: WrapupInput): string {
  const lines: string[] = []
  const title = input.task.ok
    ? input.task.value.title
    : input.status.ok
      ? input.status.value.task.title
      : ''
  const status = input.task.ok
    ? input.task.value.status
    : input.status.ok
      ? input.status.value.task.status
      : 'unknown'
  lines.push(`${input.identifier}  ${sanitizeField(title)}`)
  lines.push(
    `Status: ${status} · wrap-up report (read-only — nothing below was run or approved)`
  )
  const readiness = assessReadiness(input)
  pushContract(lines, input)
  pushTestCases(lines, input)
  pushSecurity(lines, input)
  pushCrossings(lines, input)
  pushDone(lines, input, readiness)
  return lines.join('\n') + '\n'
}

async function readJson<T>(
  url: string,
  token: string,
  pick: (body: unknown) => T
): Promise<Read<T>> {
  let res: Response
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : 'network error',
    }
  }
  if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` }
  try {
    return { ok: true, value: pick(await res.json()) }
  } catch {
    return { ok: false, reason: 'invalid response body' }
  }
}

function assessWorktrees(
  identifier: string,
  task: Read<WrapupTask>
): WrapupInput['worktrees'] {
  try {
    return planTaskWorktreeCleanup({
      taskId: identifier,
      cwd: process.cwd(),
      mergedHeadShas: task.ok
        ? mergedHeadShasOf(task.value.pullRequests ?? [])
        : [],
    })
  } catch {
    return null
  }
}

export async function taskWrapup(
  identifier: string | undefined
): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }
  const base = trimTrailingSlash(resolveAuthedApiUrl(creds.apiUrl))

  let taskId = identifier
  if (!taskId) {
    taskId = (await resolveBoundTaskIdentifier(base, creds.token)) ?? undefined
    if (!taskId) {
      console.error(
        'Error: no task given and this session is not bound to one.\n' +
          'Run `lumo task wrapup <LUM-N>`, or bind first with `lumo session attach <LUM-N>`.'
      )
      return 1
    }
  }
  const enc = encodeURIComponent(taskId)

  const [status, task, crossings] = await Promise.all([
    readJson(
      `${base}/api/tasks/${enc}/status`,
      creds.token,
      body => body as TaskStatusResponse
    ),
    readJson(`${base}/api/tasks/by-identifier/${enc}`, creds.token, body => {
      const t = (body as { task?: WrapupTask }).task
      if (!t) throw new Error('no task in response')
      return t
    }),
    fetchOpenCrossings(base, creds.token, taskId),
  ])

  // A task that does not exist is an error, not a report full of ⚠ lines.
  if (!status.ok && status.reason === 'HTTP 404') {
    console.error(
      `Error: task ${taskId} not found in workspace ${creds.workspaceSlug}`
    )
    return 1
  }
  if (!status.ok && status.reason === 'HTTP 401') {
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }

  const resolvedId = task.ok
    ? task.value.identifier
    : status.ok
      ? status.value.task.identifier
      : taskId
  process.stdout.write(
    formatWrapup({
      identifier: resolvedId,
      status,
      task,
      crossings,
      worktrees: assessWorktrees(resolvedId, task),
      dispositionUrl: dispositionUrl(
        base,
        creds.workspaceSlug ?? 'lumo',
        resolvedId
      ),
    })
  )
}
