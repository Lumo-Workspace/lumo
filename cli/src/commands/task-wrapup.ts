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
  crossingGate,
  pushSecurityActions,
  pushSecurityCoverage,
  pushTestCaseActions,
  pushTestCaseVerdictActions,
  securityHintLines,
  splitNextActions,
  testCaseVerdictBlocks,
  type TaskStatusResponse,
} from './task-status'
import { doneGateHeadline, doneGateRows } from '../lib/done-gate-format'
import {
  describeDoneTransition,
  qualifiesForOneStepDone,
  type LinkedPr,
} from './task-update'
import { errAuth, errNotLoggedIn } from '../lib/errors'
import {
  bulletLines,
  commandLine,
  fieldLines,
  sectionHeading,
  wrapLines,
  type Field,
  type LayoutOptions,
} from '../lib/report-layout'
import { colorEnabled, terminalWidth } from '../lib/ui'
import { emptyState, fmtEnum } from '../lib/format'

/**
 * `lumo task wrapup [task]` (LUM-841) — the whole wrap-up in one read.
 *
 * Wrapping a task up used to take 5–8 separate lumo calls late in a session
 * (`task status`, `pr scan`, `testcase list`, a crossing read per crossing,
 * `task update --status done` just to see its envelope, `worktree list`), and
 * every one of them is a full model step over a 300K+ context. This command
 * does the same reads in one process and prints them in the order the
 * wrap-up actually walks: test cases → security scans → boundary crossings →
 * DONE.
 *
 * It is strictly read-only: GET requests plus local `git` inspection. It
 * never requests a disposition read receipt, and
 * never changes a status. The human gates stay where they are — every
 * approval it mentions is something the agent relays to the user, and the
 * only approval-flagged command it prints is the DONE envelope's own
 * confirmCommand, shown only when nothing is left and labelled as the user's.
 * LUM-1106: when every linked PR is merged it prints the plain one-step
 * `--status done` command instead — no approval flag at all.
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
 * (`lib/acceptance/done-verdict.ts`) for what BLOCKS — a blocking crossing,
 * a blocking security finding, a proven test-case defect — and adds the
 * agent-side "not yet" condition the gate does not check (unmerged PRs).
 * Fails closed: any failed
 * read makes the verdict UNCONFIRMED, never READY.
 */
export function assessReadiness(input: WrapupInput): Readiness {
  const unconfirmed: string[] = []
  if (!input.status.ok) unconfirmed.push(`task status (${input.status.reason})`)
  if (!input.task.ok) unconfirmed.push(`task / PRs (${input.task.reason})`)
  if (input.crossings.status === 'error')
    unconfirmed.push(`boundary crossings (${input.crossings.reason})`)
  if (
    input.status.ok &&
    input.status.value.securityFindings === null // the server's own fail-closed marker
  )
    unconfirmed.push('security findings')
  // LUM-1186: the server's Done gate could not read one of its planes.
  if (
    input.status.ok &&
    input.status.value.doneGate !== undefined &&
    !input.status.value.doneGate.confirmed
  )
    unconfirmed.push(
      `the Done gate (${input.status.value.doneGate.unconfirmed.join(', ')})`
    )

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
  const blockingCrossings = crossings.filter(c => c.blocking)
  if (blockingCrossings.length > 0)
    blocked.push(
      `${plural(blockingCrossings.length, 'undispositioned boundary crossing')} — the user rules on each`
    )
  const blockingFindings = split.security.filter(a => a.blocking)
  if (blockingFindings.length > 0)
    blocked.push(
      `${plural(blockingFindings.length, 'blocking security finding')} — fix and push, or the user rules on each (see the security section)`
    )
  const defects = split.testCaseVerdict.filter(testCaseVerdictBlocks)
  if (defects.length > 0)
    blocked.push(
      `${plural(defects.length, 'test case')} with a proven defect nobody has ruled on — the user rules on each run`
    )
  // LUM-1186: the server's Done gate is the same verdict as the web Record
  // tab; if it says blocked, never report less — even when the rows above
  // found nothing (fail-closed).
  const gate = status.doneGate
  if (blocked.length === 0 && gate?.confirmed && gate.headline === 'blocked')
    blocked.push(
      `the Done gate reports ${plural(gate.blockingTotal, 'item')} blocking DONE`
    )
  if (blocked.length > 0) return { level: 'BLOCKED', reasons: blocked }

  const notYet: string[] = []
  const { unmerged } = partitionPrs(task.pullRequests ?? [])
  if (unmerged.length > 0)
    notYet.push(
      `${plural(unmerged.length, 'linked PR')} not merged (${unmerged
        .map(p => `#${p.number} ${fmtEnum(p.state)}`)
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

function header(n: number, title: string, opts: LayoutOptions): string[] {
  return sectionHeading(`[${n}/4] ${title}`, opts)
}

function pushTestCases(
  lines: string[],
  input: WrapupInput,
  opts: LayoutOptions
): void {
  lines.push(...header(1, 'Test cases', opts))
  if (!input.status.ok) {
    lines.push(
      ...wrapLines(
        `⚠ Unconfirmed — the task status could not be read (${sanitizeField(input.status.reason)}).`,
        2,
        opts
      )
    )
    return
  }
  const split = splitNextActions(input.status.value.nextActions)
  const id = input.status.value.task.identifier
  const body: string[] = []
  // A proven defect carries the user's two rulings right under its own row,
  // one command per line (LUM-1091).
  for (const d of split.testCaseVerdict) {
    pushTestCaseVerdictActions(body, [d], opts)
    if (!testCaseVerdictBlocks(d)) continue
    body.push(
      '    Blocks DONE until the user rules on that run — one of:',
      commandLine(
        `lumo task testcase disposition ${id}/TC${d.number} --known-defect`,
        6
      ),
      commandLine(
        `lumo task testcase disposition ${id}/TC${d.number} --not-a-defect`,
        6
      )
    )
  }
  pushTestCaseActions(body, split.testCase, opts)
  if (body.length === 0) {
    lines.push(`  ${emptyState('test-case signals')}`)
    return
  }
  lines.push(...body)
}

function pushSecurity(
  lines: string[],
  input: WrapupInput,
  opts: LayoutOptions
): void {
  lines.push(...header(2, 'Security scans', opts))
  if (!input.status.ok) {
    lines.push(
      ...wrapLines(
        `⚠ Unconfirmed — the task status could not be read (${sanitizeField(input.status.reason)}).`,
        2,
        opts
      )
    )
    return
  }
  const data = input.status.value
  const { security } = splitNextActions(data.nextActions)
  const body: string[] = []
  pushSecurityActions(body, security, opts)
  if (security.length > 0) body.push(...securityHintLines(opts))
  pushSecurityCoverage(body, data, opts)
  if (body.length === 0) {
    lines.push('  No linked PR scans and no open findings.')
    return
  }
  lines.push(...body)
}

function crossingCommand(ids: string[], task: string, ruling: string): string {
  return `lumo crossing disposition ${ids.map(shellQuote).join(' ')} ${ruling} --task ${shellQuote(task)}`
}

/** `batch`: several crossings share one ruling command per ruling (LUM-845),
 *  printed after the list — the row carries no command of its own. */
function pushCrossing(
  lines: string[],
  c: OpenCrossing,
  task: string,
  batch: boolean,
  opts: LayoutOptions
): void {
  lines.push(
    ...bulletLines(
      `${sanitizeField(c.ref)} [${c.severity}] ${sanitizeField(c.category)} (${crossingGate(c)})`,
      2,
      opts
    )
  )
  if (c.reversible === false)
    lines.push(
      '    ⚠ irreversible category — the action reached outside the repo'
    )
  const fields: Field[] = []
  // LUM-780: why a SYSTEM re-judge made this row advisory.
  if (!c.blocking && c.advisory && c.rejudge)
    fields.push({ label: 'Re-judged', value: oneLine(c.rejudge) })
  const detail = oneLine(c.detail)
  if (detail) fields.push({ label: 'Detail', value: clip(detail, 400) })
  const seen = c.occurrenceCount ?? 1
  if (seen > 1) fields.push({ label: 'Seen', value: `×${seen} while open` })
  const explanations = c.explanations ?? []
  if (explanations.length === 0 && c.blocking) {
    fields.push({
      label: 'Explanation',
      value: 'none — add one first (append-only; clears nothing):',
      sub: [
        `lumo crossing explain ${shellQuote(c.ref)} --task ${shellQuote(task)} --note "…"`,
      ],
    })
  } else if (explanations.length > 0) {
    fields.push({
      label: 'Explanations',
      value: `${explanations.length} — agent self-report, unverified`,
    })
  }
  lines.push(...fieldLines(fields, 4, opts))
  for (const e of explanations)
    lines.push(...dashLines(clip(oneLine(e), 300), 4, opts))
  if (!batch) {
    lines.push(
      '    The user rules — one of:',
      commandLine(crossingCommand([c.ref], task, '--false-positive'), 6),
      commandLine(crossingCommand([c.ref], task, '--confirmed'), 6)
    )
  }
}

/** A `- text` item at `indent`, wrapped with its continuation under the text. */
function dashLines(
  text: string,
  indent: number,
  opts: LayoutOptions
): string[] {
  const pad = ' '.repeat(indent)
  return wrapLines(text, indent + 2, opts).map((l, i) =>
    i === 0 ? `${pad}- ${l.trimStart()}` : l
  )
}

function pushCrossings(
  lines: string[],
  input: WrapupInput,
  opts: LayoutOptions
): void {
  lines.push(...header(3, 'Boundary crossings', opts))
  const result = input.crossings
  if (result.status === 'error') {
    lines.push(
      ...wrapLines(
        `⚠ Boundary-crossing check failed (${sanitizeField(result.reason)}) — could not confirm whether any are undispositioned.`,
        2,
        opts
      )
    )
    return
  }
  if (result.crossings.length === 0) {
    lines.push(`  ${emptyState('open crossings')}`)
    return
  }
  const blocking = result.crossings.filter(c => c.blocking).length
  lines.push(
    `  ${result.crossings.length} undispositioned: ${blocking} blocking DONE, ${result.crossings.length - blocking} advisory / non-blocking.`
  )
  const batch = result.crossings.length > 1
  lines.push(
    ...wrapLines(
      batch
        ? 'Relay them to the user as shown below. Once they rule, run one batch command per ruling (split the ids when the rulings differ; leave out any id they want to keep OPEN): it walks the server-enforced read → ruling handshake with one exit-4 envelope per step for the whole batch — relay each and add a step flag only after the user approves that step.'
        : 'Relay each one to the user as shown below. Once they pick a ruling, run that command: it walks the server-enforced read → ruling handshake, one exit-4 envelope per step — relay each and add a step flag only after the user approves that step.',
      2,
      opts
    )
  )
  for (const c of result.crossings)
    pushCrossing(lines, c, input.identifier, batch, opts)
  if (batch) {
    const ids = result.crossings.map(c => c.ref)
    lines.push(
      `  The user rules all ${ids.length} false-positive:`,
      commandLine(
        crossingCommand(ids, input.identifier, '--false-positive'),
        4
      ),
      `  The user rules all ${ids.length} confirmed:`,
      commandLine(crossingCommand(ids, input.identifier, '--confirmed'), 4)
    )
  }
  lines.push('  Web panel:', commandLine(input.dispositionUrl, 4))
}

/** The separator `describeWorktreeCleanup` puts before a kept worktree's removal command. */
const KEEP_LATER = ' — remove it later from elsewhere: '

function pushDone(
  lines: string[],
  input: WrapupInput,
  r: Readiness,
  opts: LayoutOptions
): void {
  lines.push(...header(4, 'DONE', opts))
  // LUM-1106: READY with every linked PR merged (at least one) is the
  // one-step case — `task update --status done` runs without an envelope.
  // READY already means every read succeeded and nothing blocks DONE.
  const oneStep =
    r.level === 'READY' &&
    input.task.ok &&
    qualifiesForOneStepDone(input.task.value.pullRequests, true)
  const label: Record<Readiness['level'], string> = {
    DONE: 'DONE — already closed',
    UNCONFIRMED:
      'CANNOT CONFIRM — a read failed; do not assume anything is clear',
    BLOCKED: 'BLOCKED — a human-only gate would refuse DONE',
    NOT_YET: 'NOT YET — work is left before asking for DONE',
    READY: 'READY — relay the DONE envelope below to the user',
  }
  lines.push(
    `  Readiness: ${oneStep ? 'READY — one step: every linked PR is merged and nothing blocks DONE' : label[r.level]}`
  )
  for (const reason of r.reasons)
    lines.push(...dashLines(sanitizeField(reason), 4, opts))
  // LUM-1186: the web Record tab's Done gate, same verdict and rows.
  if (input.status.ok) {
    const gate = input.status.value.doneGate
    lines.push(`  Done gate: ${doneGateHeadline(gate)}`)
    if (gate?.confirmed) lines.push(...doneGateRows(gate, 4, opts))
  }

  // What moving to DONE would change — the same lines `task update --status
  // done` puts in its envelope, so the user can be shown it from here. They
  // are printed verbatim (the envelope's own wording), not re-wrapped.
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
  for (const c of change) {
    // The envelope's keep line ends in the command that removes the
    // worktree later; here the command gets a line of its own.
    const [lead, cmd] = c.split(KEEP_LATER)
    if (cmd === undefined) lines.push(`    ${c}`)
    else
      lines.push(
        ...wrapLines(`${lead}${KEEP_LATER.trimEnd()}`, 4, opts),
        commandLine(cmd, 6)
      )
  }

  if (r.level === 'READY') {
    const inside = input.worktrees?.items.some(i => i.reason === 'cwd')
    lines.push(
      ...(oneStep
        ? [
            '  All PRs merged, nothing blocks DONE — run it as-is (status only), no approval step:',
            commandLine(
              `lumo task update ${input.identifier} --status done`,
              4
            ),
          ]
        : [
            '  Show the user the lines above. Only after they approve, run:',
            commandLine(
              `lumo task update ${input.identifier} --status done --confirm`,
              4
            ),
          ])
    )
    if (inside && input.worktrees) {
      lines.push(
        ...wrapLines(
          `Run it from ${input.worktrees.mainRoot} — the current directory is inside this task's worktree, which blocks its removal.`,
          2,
          opts
        )
      )
    }
  } else if (r.level !== 'DONE') {
    lines.push(
      '  Clear the items above, then run again:',
      commandLine(`lumo task wrapup ${input.identifier}`, 4)
    )
  }
}

/** Render the whole report. Pure — every input is already read. */
export function formatWrapup(
  input: WrapupInput,
  layout: LayoutOptions = {}
): string {
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
  lines.push(`Status: ${status}`)
  lines.push('Wrap-up report — read-only: nothing below was run or approved.')
  const readiness = assessReadiness(input)
  pushTestCases(lines, input, layout)
  pushSecurity(lines, input, layout)
  pushCrossings(lines, input, layout)
  pushDone(lines, input, readiness, layout)
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
    console.error(errNotLoggedIn())
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
    console.error(errAuth())
    return 1
  }

  const resolvedId = task.ok
    ? task.value.identifier
    : status.ok
      ? status.value.task.identifier
      : taskId
  process.stdout.write(
    formatWrapup(
      {
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
      },
      {
        width: terminalWidth(),
        color: colorEnabled(),
        tty: Boolean(process.stdout.isTTY),
      }
    )
  )
}
