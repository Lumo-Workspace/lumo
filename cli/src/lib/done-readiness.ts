/**
 * LUM-1233 batch 1 — DONE readiness, formerly the last section of
 * `lumo task wrapup` (LUM-841). `task status` appends it when the task is
 * READY: nothing blocks DONE, every read succeeded and every linked PR is
 * merged — together with what moving to DONE would change and the one
 * command to run next (the user's approval step, or the LUM-1106 one-step
 * `--status done`).
 *
 * Read-only: the inputs are GETs plus local `git` inspection; it never
 * requests a read receipt and never changes a status.
 */
import { sanitizeField } from './sanitize'
import type { OpenCrossingsResult } from './open-crossings'
import {
  mergedHeadShasOf,
  describeWorktreeCleanup,
  planTaskWorktreeCleanup,
  type CleanupItem,
} from './worktree-cleanup'
import {
  splitNextActions,
  testCaseVerdictBlocks,
  type TaskStatusResponse,
} from '../commands/task-status'
import { doneGateHeadline, doneGateRows } from './done-gate-format'
import {
  describeDoneTransition,
  qualifiesForOneStepDone,
  type LinkedPr,
} from '../commands/task-update'
import {
  commandLine,
  sectionHeading,
  wrapLines,
  type LayoutOptions,
} from './report-layout'
import { fmtEnum } from './format'

export type Read<T> = { ok: true; value: T } | { ok: false; reason: string }

export interface ReadinessTask {
  identifier: string
  title: string
  status: string
  /** Absent on older servers — treated as "none linked". */
  pullRequests?: LinkedPr[]
}

export interface ReadinessInput {
  identifier: string
  status: Read<TaskStatusResponse>
  task: Read<ReadinessTask>
  crossings: OpenCrossingsResult
  /** Local worktree assessment; `null` = not a git checkout / could not tell. */
  worktrees: { mainRoot: string; items: CleanupItem[] } | null
}

export type Readiness =
  | { level: 'DONE'; reasons: string[] }
  | { level: 'CANCELED'; reasons: string[] }
  | { level: 'UNCONFIRMED'; reasons: string[] }
  | { level: 'BLOCKED'; reasons: string[] }
  | { level: 'NOT_YET'; reasons: string[] }
  | { level: 'READY'; reasons: string[] }

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
export function assessReadiness(input: ReadinessInput): Readiness {
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
  // LUM-1282: closed by a human ruling — there is no DONE to get ready for.
  if (taskStatus === 'CANCELED') {
    return {
      level: 'CANCELED',
      reasons: [
        "The task is CANCELED. Reopening it is the user's call; do not work on it.",
      ],
    }
  }

  if (unconfirmed.length > 0) {
    return {
      level: 'UNCONFIRMED',
      reasons: unconfirmed.map(u => `could not read ${u}`),
    }
  }

  const status = (input.status as { ok: true; value: TaskStatusResponse }).value
  const task = (input.task as { ok: true; value: ReadinessTask }).value
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
  // LUM-1334: requirements the workspace switched on.
  if (split.requirements.length > 0)
    blocked.push(
      `${plural(split.requirements.length, 'missing requirement')} — ${split.requirements
        .map(
          r =>
            `PR #${r.prNumber} needs ${r.requirement === 'TEST_CASE' ? 'a passing test case' : 'a review'}`
        )
        .join(', ')} on its latest commit`
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

/** The separator `describeWorktreeCleanup` puts before a kept worktree's removal command. */
const KEEP_LATER = ' — remove it later from elsewhere: '

export function formatDoneReadiness(
  input: ReadinessInput,
  r: Readiness,
  opts: LayoutOptions = {}
): string[] {
  const lines: string[] = []
  lines.push(...sectionHeading('DONE readiness', opts))
  // LUM-1106: READY with every linked PR merged (at least one) is the
  // one-step case — `task update --status done` runs without an envelope.
  // READY already means every read succeeded and nothing blocks DONE.
  const oneStep =
    r.level === 'READY' &&
    input.task.ok &&
    qualifiesForOneStepDone(input.task.value.pullRequests, true)
  const label: Record<Readiness['level'], string> = {
    DONE: 'DONE — already closed',
    CANCELED: 'CANCELED — closed by the user, not delivered',
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
  if (r.level === 'CANCELED') return lines
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
      commandLine(`lumo task status ${input.identifier}`, 4)
    )
  }
  return lines
}

export async function readJson<T>(
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

export function assessWorktrees(
  identifier: string,
  task: Read<ReadinessTask>
): ReadinessInput['worktrees'] {
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

/**
 * The one command to run next when the task is READY, or null otherwise:
 * the plain `--status done` when every linked PR is merged (LUM-1106 one-step
 * case), else the user's approval step with `--confirm`.
 */
export function readinessNextCommand(
  input: ReadinessInput,
  r: Readiness
): string | null {
  if (r.level !== 'READY') return null
  const oneStep =
    input.task.ok &&
    qualifiesForOneStepDone(input.task.value.pullRequests, true)
  return oneStep
    ? `lumo task update ${input.identifier} --status done`
    : `lumo task update ${input.identifier} --status done --confirm`
}
