import { fmtEnum } from '../lib/format'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { normalizePriority } from './task-create'
import { resolveTagRefs } from '../lib/tag-resolver'
import { resolveSprintId } from '../lib/resolve'
import { sanitizeField } from '../lib/sanitize'
import { localDayStart } from '../lib/local-day'
import { emitNextSteps, type NextStep } from '../lib/next-steps'
import { emitConfirmation } from '../lib/confirmation'
import {
  describeWorktreeCleanup,
  fetchCleanupInfo,
  mergedHeadShasOf,
  planTaskWorktreeCleanup,
  removeWorktrees,
  reportRemoval,
} from '../lib/worktree-cleanup'
import {
  buildBlockedError,
  collectDoneBlockers,
  emitBlocked,
  isDoneGateRefusal,
} from '../lib/blocked-error'
import {
  fetchStatusDigest,
  printStatusDigest,
  readStatusDigest,
} from '../lib/status-digest'
import { resolveSessionId } from '../lib/session-id'
import {
  errAuth,
  errHttp,
  errNotLoggedIn,
  httpFailed,
  warn,
} from '../lib/errors'

const ALLOWED_STATUSES = [
  'BACKLOG',
  'TODO',
  'IN_PROGRESS',
  'IN_REVIEW',
  'DONE',
] as const
type Status = (typeof ALLOWED_STATUSES)[number]

export interface UpdateTaskOptions {
  title?: string
  description?: string
  status?: string
  priority?: string
  assignee?: string
  milestone?: string
  sprint?: string
  /** LUM-821: due day YYYY-MM-DD (local timezone); "" clears. */
  due?: string
  /** LUM-646: `--claimable` sets the agent-claimable marker true. */
  claimable?: boolean
  /** LUM-646: `--not-claimable` sets it false. Mutually exclusive with the above. */
  notClaimable?: boolean
  tag?: string[]
  tagId?: string[]
  addTag?: string[]
  addTagId?: string[]
  removeTag?: string[]
  removeTagId?: string[]
  /** Commander sets this to false for `--no-hints` (LUM-686). */
  hints?: boolean
  /**
   * LUM-755: the user has approved the DONE transition shown in the
   * confirmation envelope. Only meaningful with `--status done`; there is
   * deliberately no `--yes` alias on this command.
   */
  confirm?: boolean
}

// ---------------------------------------------------------------------------
// Sprint action decision logic
// ---------------------------------------------------------------------------

export type SprintAction =
  | { type: 'noop-clear' }
  | { type: 'noop-same'; sprintId: string }
  | { type: 'unbind'; oldSprintId: string }
  | { type: 'bind'; newSprintId: string }
  | { type: 'rebind'; oldSprintId: string; newSprintId: string }

/**
 * Pure function: given the task's current sprint binding and the resolved
 * sprint id from the --sprint flag ('' to clear), decide what action to take.
 *
 * `flag` is the **resolved** sprint id (or '' to clear). It is NOT the raw
 * CLI flag value — the caller must resolve the sprint ref before calling this.
 */
export function decideSprintAction(input: {
  currentSprintId: string | null
  flag: string
}): SprintAction {
  const { currentSprintId, flag } = input

  if (flag === '') {
    // Clear intent
    if (currentSprintId === null) return { type: 'noop-clear' }
    return { type: 'unbind', oldSprintId: currentSprintId }
  }

  // Bind intent (non-empty resolved sprint id)
  if (currentSprintId === null) return { type: 'bind', newSprintId: flag }
  if (currentSprintId === flag) return { type: 'noop-same', sprintId: flag }
  return { type: 'rebind', oldSprintId: currentSprintId, newSprintId: flag }
}

interface UpdatedTaskResponse {
  task: {
    id: string
    identifier: string
    title: string
    url: string
    taskTags?: Array<{ name: string }>
  }
  /** Absent on older servers — the block is simply omitted (LUM-686). */
  nextSteps?: NextStep[]
}

/**
 * Normalize a user-supplied status value. Accepts both `IN_PROGRESS` and
 * `in-progress` forms; returns null on unknown values so the caller can
 * print a context-aware error.
 */
export function normalizeStatus(value: string): Status | null {
  if (!value) return null
  const upper = value.toUpperCase().replace(/-/g, '_')
  return (ALLOWED_STATUSES as readonly string[]).includes(upper)
    ? (upper as Status)
    : null
}

/**
 * Translate parsed CLI flags into the wire payload for
 * `PATCH /api/tasks/by-identifier/[identifier]`. Empty-string description /
 * assignee become `null` (clear). Caller is responsible for normalizing
 * status / priority before passing them in.
 */
export function buildUpdatePayload(opts: UpdateTaskOptions): {
  payload: Record<string, unknown>
  flagsGiven: string[]
} {
  const payload: Record<string, unknown> = {}
  const flagsGiven: string[] = []

  if (opts.title !== undefined) {
    payload.title = opts.title
    flagsGiven.push('--title')
  }
  if (opts.description !== undefined) {
    payload.description = opts.description === '' ? null : opts.description
    flagsGiven.push('--description')
  }
  if (opts.status !== undefined) {
    payload.status = opts.status
    flagsGiven.push('--status')
  }
  if (opts.priority !== undefined) {
    payload.priority = opts.priority
    flagsGiven.push('--priority')
  }
  if (opts.assignee !== undefined) {
    payload.assigneeRef = opts.assignee === '' ? null : opts.assignee
    flagsGiven.push('--assignee')
  }
  if (opts.milestone !== undefined) {
    payload.milestoneRef = opts.milestone === '' ? null : opts.milestone
    flagsGiven.push('--milestone')
  }
  // LUM-821: a due day becomes its local-midnight instant (the web picker's
  // storage convention). The caller validates the day first.
  if (opts.due !== undefined) {
    payload.dueDate = opts.due === '' ? null : localDayStart(opts.due)
    flagsGiven.push('--due')
  }
  // LUM-646: resolved agent-claimable marker (true/false). The caller collapses
  // --claimable / --not-claimable into this single tri-state before building.
  if (opts.claimable !== undefined) {
    payload.claimable = opts.claimable
    flagsGiven.push(opts.claimable ? '--claimable' : '--not-claimable')
  }

  return { payload, flagsGiven }
}

/**
 * Single-line success output. Mirrors `formatCreatedTaskLine` for grep-
 * ability — embedded double-quotes are backslash-escaped.
 * Appends a Tags line when tags are present.
 */
export function formatUpdatedTaskLine(task: {
  id: string
  identifier: string
  title: string
  url: string
  tags?: string[]
}): string {
  const escapedTitle = sanitizeField(task.title).replace(/"/g, '\\"')
  const head = `Updated ${task.identifier} "${escapedTitle}"  ${task.url}`
  if (task.tags && task.tags.length > 0) {
    return `${head}\nTags: ${task.tags.map(sanitizeField).join(', ')}`
  }
  return head
}

// ---------------------------------------------------------------------------
// LUM-755: DONE confirmation envelope (supersedes LUM-731's y/N prompt)
// ---------------------------------------------------------------------------

/** The slice of a linked PR the DONE envelope needs to show. */
export interface LinkedPr {
  number: number
  title: string | null
  url: string | null
  state: string | null
  /** LUM-825: absent on older servers. */
  headSha?: string | null
}

/**
 * Split linked PRs into merged vs everything else. "Unmerged" is deliberately
 * broad — open, closed-without-merge, draft (state "open"), or an unknown
 * state all count — because the question the ⚠ line asks is "are you sure
 * the work actually landed?", and only `merged` answers yes.
 */
export function partitionLinkedPrs(prs: LinkedPr[]): {
  merged: LinkedPr[]
  unmerged: LinkedPr[]
} {
  const merged: LinkedPr[] = []
  const unmerged: LinkedPr[] = []
  for (const pr of prs) {
    if (pr.state === 'merged') merged.push(pr)
    else unmerged.push(pr)
  }
  return { merged, unmerged }
}

function formatPrLine(pr: LinkedPr): string {
  const state = fmtEnum(pr.state).padEnd(7)
  const title = pr.title ? sanitizeField(pr.title) : '(untitled)'
  const url = pr.url ? `  ${pr.url}` : ''
  return `#${pr.number}  ${state}  ${title}${url}`
}

/**
 * The changes[] block of the DONE envelope: what is about to change, every
 * linked PR with its synced state, and — last — a ⚠ line naming the PRs that
 * have not merged. That single line replaces LUM-731's second y/N prompt:
 * the protocol is one step, and the agent relays the whole block verbatim.
 */
export function describeDoneTransition(
  task: { identifier: string; title: string; status: string },
  prs: LinkedPr[]
): string[] {
  const escapedTitle = sanitizeField(task.title).replace(/"/g, '\\"')
  const lines = [
    `Will move ${task.identifier} "${escapedTitle}" to DONE`,
    `Status: ${task.status} → DONE`,
  ]
  if (prs.length === 0) {
    lines.push('Pull requests: none linked')
    return lines
  }
  for (const pr of prs) lines.push(formatPrLine(pr))
  const { unmerged } = partitionLinkedPrs(prs)
  if (unmerged.length > 0) {
    const summary = unmerged
      .map(pr => `#${pr.number} ${fmtEnum(pr.state)}`)
      .join(', ')
    lines.push(
      `⚠ ${unmerged.length} linked pull request${unmerged.length === 1 ? '' : 's'} not merged: ${summary}`
    )
  }
  return lines
}

/**
 * LUM-1106: the one-step DONE condition — at least one linked PR, every one
 * merged, and a status digest that read cleanly with nothing blocking DONE.
 * Fail-closed: `prs` undefined (an older server that sends no
 * `pullRequests`), none linked, any PR not merged, or a digest that is not
 * clear all keep the confirmation envelope.
 */
export function qualifiesForOneStepDone(
  prs: LinkedPr[] | undefined,
  digestClearsDone: boolean
): boolean {
  if (!digestClearsDone || !prs || prs.length === 0) return false
  return partitionLinkedPrs(prs).unmerged.length === 0
}

/**
 * LUM-1116: the flags besides `--status` that a DONE update also applies.
 * One step covers a status-only change; anything else rides in the envelope
 * so the user signs off on it too.
 */
export function otherFlagsThanStatus(
  flagsGiven: string[],
  opts: Pick<
    UpdateTaskOptions,
    | 'tag'
    | 'tagId'
    | 'addTag'
    | 'addTagId'
    | 'removeTag'
    | 'removeTagId'
    | 'sprint'
  >
): string[] {
  const other = flagsGiven.filter(f => f !== '--status')
  const given = (v: string[] | undefined) => v !== undefined && v.length > 0
  if (given(opts.tag) || given(opts.tagId)) other.push('--tag')
  if (given(opts.addTag) || given(opts.addTagId)) other.push('--add-tag')
  if (given(opts.removeTag) || given(opts.removeTagId))
    other.push('--remove-tag')
  if (opts.sprint !== undefined) other.push('--sprint')
  return other
}

/** The envelope line naming the other changes, or nothing. */
export function describeOtherChanges(otherFlags: string[]): string[] {
  if (otherFlags.length === 0) return []
  return [
    `Also updates: ${otherFlags.join(', ')} (one-step DONE covers a status-only change)`,
  ]
}

/** What a one-step DONE prints after the `Updated …` line (LUM-1106). */
export function describeOneStepDone(
  task: { identifier: string; title: string; status: string },
  prs: LinkedPr[]
): string[] {
  return [
    `One-step DONE (no --confirm needed): ${prs.length === 1 ? 'the linked PR is' : `all ${prs.length} linked PRs are`} merged and nothing blocks DONE.`,
    ...describeDoneTransition(task, prs)
      .slice(1)
      .map(l => `  ${l}`),
  ]
}

type DoneGate =
  | { kind: 'exit'; code: number }
  | { kind: 'one-step'; summary: string[] }

/**
 * Look the task up and decide how DONE proceeds. When the one-step
 * condition holds (LUM-1106) it returns `one-step` and the caller sends the
 * PATCH; otherwise it emits the DONE confirmation envelope (exit 4). Runs
 * before any side effect — tag find-or-create included — so a refused DONE
 * leaves nothing behind. Prints its own error on a failed lookup.
 */
async function gateDone(args: {
  base: string
  apiUrl: string
  token: string
  identifier: string
  /**
   * LUM-1116: the other flags given alongside `--status done` (`--title`,
   * `--add-tag`, `--sprint` …). Any at all keeps the envelope — one step
   * covers the status change only — and the envelope names them.
   */
  otherFlags: string[]
}): Promise<DoneGate> {
  const exit = (code: number): DoneGate => ({ kind: 'exit', code })
  const { base, apiUrl, token, identifier, otherFlags } = args
  const showUrl = `${base}/api/tasks/by-identifier/${encodeURIComponent(identifier)}`
  const lookup = fetch(showUrl, {
    headers: { Authorization: `Bearer ${token}` },
  })
  // LUM-842: the status digest rides in the envelope (additive field), read
  // alongside the task lookup. It never rejects. LUM-1106: the same read
  // decides whether DONE may run in one step.
  const digest = readStatusDigest(base, token, identifier)
  let res: Response
  try {
    res = await lookup
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
    return exit(1)
  }
  if (res.status === 401) {
    console.error(errAuth())
    return exit(1)
  }
  if (!res.ok) {
    let serverMsg: string | null = null
    try {
      const errBody = (await res.json()) as { error?: string }
      if (typeof errBody.error === 'string') serverMsg = errBody.error
    } catch {
      // not JSON
    }
    console.error(
      serverMsg
        ? `Error: ${sanitizeField(serverMsg)}`
        : errHttp('task lookup', res.status)
    )
    return exit(1)
  }

  const { task } = (await res.json()) as {
    task: {
      identifier: string
      title: string
      status: string
      /** Absent on older servers — treated as "none linked". */
      pullRequests?: LinkedPr[]
    }
  }
  const { lines: statusSummary, clearsDone } = await digest
  // Already DONE: nothing to move — keep the envelope (pre-LUM-1106
  // behaviour) rather than sending a DONE → DONE PATCH unasked.
  if (
    task.status !== 'DONE' &&
    otherFlags.length === 0 &&
    qualifiesForOneStepDone(task.pullRequests, clearsDone)
  ) {
    return {
      kind: 'one-step',
      summary: describeOneStepDone(task, task.pullRequests ?? []),
    }
  }
  const prs = task.pullRequests ?? []
  return exit(
    emitConfirmation({
      command: 'task update',
      changes: [
        ...describeDoneTransition(task, prs),
        ...describeOtherChanges(otherFlags),
        ...doneWorktreeLines(task.identifier, mergedHeadShasOf(prs)),
      ],
      statusSummary,
    })
  )
}

/**
 * LUM-825: the DONE envelope also says what happens to this task's local
 * worktrees — each one removed, or kept with its reason. Best-effort: a git
 * failure here drops the lines, never the envelope.
 */
function doneWorktreeLines(
  identifier: string,
  mergedHeadShas: string[]
): string[] {
  try {
    const plan = planTaskWorktreeCleanup({
      taskId: identifier,
      cwd: process.cwd(),
      mergedHeadShas,
    })
    if (!plan || plan.items.length === 0) return []
    return describeWorktreeCleanup(plan.items, plan.mainRoot)
  } catch {
    return []
  }
}

/**
 * LUM-825: after a confirmed DONE lands, remove the task's worktrees the
 * envelope listed as removable — re-assessed now, so one that turned dirty
 * in between is kept. Never --force, never deletes a branch, never changes
 * the command's exit code.
 */
async function cleanupWorktreesAfterDone(args: {
  base: string
  token: string
  identifier: string
}): Promise<void> {
  try {
    const cwd = process.cwd()
    let plan = planTaskWorktreeCleanup({
      taskId: args.identifier,
      cwd,
      mergedHeadShas: [],
    })
    if (!plan || plan.items.length === 0) return
    if (plan.items.some(i => i.reason === 'unlanded')) {
      const info = await fetchCleanupInfo(
        args.base,
        args.token,
        args.identifier
      )
      if (info && info.mergedHeadShas.length > 0) {
        plan = planTaskWorktreeCleanup({
          taskId: args.identifier,
          cwd,
          mergedHeadShas: info.mergedHeadShas,
        })
        if (!plan) return
      }
    }
    reportRemoval(
      plan.items,
      removeWorktrees(plan.mainRoot, plan.items),
      plan.mainRoot
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(warn(`worktree cleanup skipped (${msg})`))
  }
}

/**
 * Thin wrapper so the next-step block always lands last (LUM-686). The update
 * flow has several success exits — a plain PATCH, plus the sprint bind/unbind
 * branches — and hints belong after whatever the command printed, not wedged
 * before the Sprint line. Only the wrapper emits; the inner run just collects.
 */
export async function taskUpdate(
  identifier: string | undefined,
  opts: UpdateTaskOptions
): Promise<number | void> {
  const collected: { steps: NextStep[] } = { steps: [] }
  const code = await runTaskUpdate(identifier, opts, collected)
  // Success only — a failed update's advice would be noise on top of an error.
  if (code === undefined) emitNextSteps(collected.steps, opts)
  return code
}

async function runTaskUpdate(
  identifier: string | undefined,
  opts: UpdateTaskOptions,
  collected: { steps: NextStep[] }
): Promise<number | void> {
  if (!identifier || identifier.trim().length === 0) {
    console.error(
      'Error: missing <identifier>. Usage: lumo task update <LUM-42> [options]'
    )
    return 1
  }

  // CLI-side mutex check: --tag/--tag-id (bulk replace) vs --add-tag/--add-tag-id/--remove-tag/--remove-tag-id (incremental)
  // Must run BEFORE any network call.
  const hasBulk =
    (opts.tag && opts.tag.length > 0) || (opts.tagId && opts.tagId.length > 0)
  const hasIncremental =
    (opts.addTag && opts.addTag.length > 0) ||
    (opts.addTagId && opts.addTagId.length > 0) ||
    (opts.removeTag && opts.removeTag.length > 0) ||
    (opts.removeTagId && opts.removeTagId.length > 0)
  if (hasBulk && hasIncremental) {
    console.error(
      'Error: --tag/--tag-id are mutually exclusive with --add-tag/--add-tag-id/--remove-tag/--remove-tag-id'
    )
    return 1
  }

  // LUM-646: collapse --claimable / --not-claimable into one tri-state
  // (undefined = don't touch). The two flags cannot both be set.
  if (opts.claimable && opts.notClaimable) {
    console.error(
      'Error: --claimable and --not-claimable are mutually exclusive'
    )
    return 1
  }
  let claimable: boolean | undefined
  if (opts.claimable) claimable = true
  else if (opts.notClaimable) claimable = false

  // Normalize status / priority before payload build.
  if (opts.due !== undefined && opts.due !== '' && !localDayStart(opts.due)) {
    console.error(
      `Error: --due expects a valid YYYY-MM-DD date (or "" to clear), got "${opts.due}"`
    )
    return 1
  }

  let status: Status | undefined
  if (opts.status !== undefined) {
    const n = normalizeStatus(opts.status)
    if (!n) {
      console.error(
        `Error: invalid status "${opts.status}". Allowed: ${ALLOWED_STATUSES.map(s => s.toLowerCase()).join(', ')}`
      )
      return 1
    }
    status = n
  }

  let priority: string | undefined
  if (opts.priority !== undefined) {
    const n = normalizePriority(opts.priority)
    if (!n) {
      console.error(
        `Error: invalid priority "${opts.priority}". Allowed: low, medium, high, urgent`
      )
      return 1
    }
    priority = n
  }

  const { payload, flagsGiven } = buildUpdatePayload({
    ...opts,
    ...(status !== undefined ? { status } : {}),
    ...(priority !== undefined ? { priority } : {}),
    ...(claimable !== undefined ? { claimable } : {}),
  })

  // Tag fields count as "something to update" even when no other flags given
  const hasTagFields = hasBulk || hasIncremental
  const hasSprintFlag = opts.sprint !== undefined

  if (flagsGiven.length === 0 && !hasTagFields && !hasSprintFlag) {
    console.error(
      'Error: provide at least one field to update (--title, --description, --status, --priority, --assignee, --milestone, --sprint, --due, --tag, --add-tag, --remove-tag)'
    )
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }

  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)

  // LUM-755: DONE without --confirm stops here with the confirmation
  // envelope — before tag resolution (find-or-create) or any other write.
  // LUM-1106: unless every linked PR is merged and nothing blocks DONE; then
  // it runs in one step and says so after the `Updated …` line. LUM-1116:
  // only for a status-only change — any other flag keeps the envelope.
  let oneStepSummary: string[] | undefined
  if (status === 'DONE' && !opts.confirm) {
    const gate = await gateDone({
      base: trimTrailingSlash(apiUrl),
      apiUrl,
      token: creds.token,
      identifier,
      otherFlags: otherFlagsThanStatus(flagsGiven, opts),
    })
    if (gate.kind === 'exit') return gate.code
    oneStepSummary = gate.summary
  }

  // Resolve tag refs into ids
  let tagIds: string[] | undefined
  let addTagIds: string[] | undefined
  let removeTagIds: string[] | undefined
  const deps = { apiUrl, token: creds.token }
  try {
    if (hasBulk) {
      tagIds = await resolveTagRefs(
        { names: opts.tag ?? [], ids: opts.tagId ?? [] },
        deps
      )
    } else if (hasIncremental) {
      if (
        (opts.addTag && opts.addTag.length > 0) ||
        (opts.addTagId && opts.addTagId.length > 0)
      ) {
        addTagIds = await resolveTagRefs(
          { names: opts.addTag ?? [], ids: opts.addTagId ?? [] },
          deps
        )
      }
      if (
        (opts.removeTag && opts.removeTag.length > 0) ||
        (opts.removeTagId && opts.removeTagId.length > 0)
      ) {
        // NOTE: --remove-tag <unknown-name> creates the Tag via find-or-create, then
        // the detach is a no-op. Net effect: orphan Tag row. Acceptable v1 trade-off.
        removeTagIds = await resolveTagRefs(
          { names: opts.removeTag ?? [], ids: opts.removeTagId ?? [] },
          deps
        )
      }
    }
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`)
    return 1
  }

  if (tagIds !== undefined) payload.tagIds = tagIds
  if (addTagIds !== undefined) payload.addTagIds = addTagIds
  if (removeTagIds !== undefined) payload.removeTagIds = removeTagIds

  const base = trimTrailingSlash(apiUrl)

  // Only do the PATCH when there are actual task fields to update.
  // If --sprint is the only flag given, skip the PATCH entirely.
  const hasPatchFields = flagsGiven.length > 0 || hasTagFields

  if (hasPatchFields) {
    const patchUrl = `${base}/api/tasks/by-identifier/${encodeURIComponent(identifier)}`

    // When run inside a Claude Code session, pass its id so a status→DONE
    // update attributes the resulting Layer 2 PROJECT memories to this
    // session — the next session-start surfaces them for review (LUM-165).
    // Absent outside Claude Code; the server treats the header as optional.
    const headers: Record<string, string> = {
      Authorization: `Bearer ${creds.token}`,
      'Content-Type': 'application/json',
    }
    const sessionId = await resolveSessionId({ write: true })
    if (sessionId) headers['X-Lumo-Session-Id'] = sessionId

    let res: Response
    try {
      res = await fetch(patchUrl, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(payload),
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
      return 1
    }

    if (res.status === 401) {
      console.error(errAuth())
      return 1
    }

    if (res.status === 200) {
      const data = (await res.json()) as UpdatedTaskResponse

      // Read tag names off the response (present when tags were changed)
      const responseTagNames =
        tagIds !== undefined ||
        addTagIds !== undefined ||
        removeTagIds !== undefined
          ? (data.task.taskTags ?? []).map(t => t.name)
          : undefined

      const taskLine: {
        id: string
        identifier: string
        title: string
        url: string
        tags?: string[]
      } = {
        id: data.task.id,
        identifier: data.task.identifier,
        title: data.task.title,
        url: data.task.url,
      }
      if (responseTagNames !== undefined) taskLine.tags = responseTagNames
      process.stdout.write(formatUpdatedTaskLine(taskLine) + '\n')
      if (oneStepSummary) process.stdout.write(oneStepSummary.join('\n') + '\n')
      if (status === 'DONE') {
        await cleanupWorktreesAfterDone({
          base,
          token: creds.token,
          identifier: data.task.identifier,
        })
      }
      // LUM-842: a status move changes where the task stands — print it
      // here so the agent does not follow up with `lumo task status`.
      if (status !== undefined) {
        await printStatusDigest(base, creds.token, data.task.identifier)
      }
      collected.steps = data.nextSteps ?? []
    } else {
      let serverMsg: string | null = null
      try {
        const errBody = (await res.json()) as { error?: string }
        if (typeof errBody.error === 'string') serverMsg = errBody.error
      } catch {
        // Body wasn't JSON; fall through to status-only message
      }
      // LUM-755: a DONE refused by a server gate (boundary
      // crossing / blocking security finding) is a human-only block, not a
      // generic error — surface it structured (exit 5) with every blocker.
      if (
        res.status === 409 &&
        status === 'DONE' &&
        isDoneGateRefusal(serverMsg)
      ) {
        const { blockers, unconfirmed, nonBlocking } =
          await collectDoneBlockers({
            base,
            token: creds.token,
            identifier,
            apiUrl,
            workspaceSlug: creds.workspaceSlug ?? '',
          })
        const statusSummary = await fetchStatusDigest(
          base,
          creds.token,
          identifier
        )
        return emitBlocked(
          buildBlockedError({
            identifier,
            message: serverMsg as string,
            blockers,
            unconfirmed,
            nonBlocking,
            apiUrl,
            workspaceSlug: creds.workspaceSlug ?? '',
            statusSummary,
          })
        )
      }
      if (serverMsg) {
        console.error(`Error: ${sanitizeField(serverMsg)}`)
      } else {
        console.error(errHttp('task update', res.status))
      }
      return 1
    }
  }

  // Sprint flag handling — runs after successful PATCH (or as standalone op)
  if (hasSprintFlag) {
    // GET /api/tasks/by-identifier/<id> to learn currentSprintId and teamId
    const showUrl = `${base}/api/tasks/by-identifier/${encodeURIComponent(identifier)}`
    let showRes: Response
    try {
      showRes = await fetch(showUrl, {
        headers: { Authorization: `Bearer ${creds.token}` },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
      return 1
    }
    if (showRes.status === 401) {
      console.error(errAuth())
      return 1
    }
    if (!showRes.ok) {
      console.error(errHttp('task lookup', showRes.status))
      return 1
    }
    const showData = (await showRes.json()) as {
      task: {
        id: string
        identifier: string
        sprintId: string | null
        teamId: string
      }
    }
    const task = showData.task

    // Resolve new sprint id ('' → clear, non-empty → resolve ref).
    // Also store the sprint number/name once resolved so we don't need extra
    // GETs for output formatting on bind/rebind/noop-same.
    let resolvedSprintId = ''
    let resolvedSprintNumber: number | null = null
    if (opts.sprint !== '') {
      const workspaceSlug = creds.workspaceSlug ?? ''
      let sprint: { id: string; number: number; name: string; teamId: string }
      try {
        sprint = await resolveSprintId(
          base,
          creds.token,
          opts.sprint!,
          undefined,
          workspaceSlug
        )
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`)
        return 1
      }

      // UUID path: resolveSprintId returns placeholder with teamId === ''
      if (sprint.teamId === '') {
        let sprintRes: Response
        try {
          sprintRes = await fetch(`${base}/api/sprints/${sprint.id}`, {
            headers: { Authorization: `Bearer ${creds.token}` },
          })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
          return 1
        }
        if (!sprintRes.ok) {
          console.error(errHttp('sprint lookup', sprintRes.status))
          return 1
        }
        const { sprint: full } = (await sprintRes.json()) as {
          sprint: { id: string; number: number; name: string; teamId: string }
        }
        sprint = {
          id: full.id,
          number: full.number,
          name: full.name,
          teamId: full.teamId,
        }
      }

      // Cross-team check
      if (sprint.teamId !== task.teamId) {
        console.error(
          `Error: Sprint binding skipped: sprint #${sprint.number} belongs to a different team than task ${task.identifier}`
        )
        return 1
      }

      resolvedSprintId = sprint.id
      resolvedSprintNumber = sprint.number
    }

    const action = decideSprintAction({
      currentSprintId: task.sprintId,
      flag: resolvedSprintId,
    })

    if (action.type === 'noop-clear') {
      process.stdout.write(`Task ${task.identifier} has no sprint binding\n`)
      return
    }

    if (action.type === 'noop-same') {
      // resolvedSprintNumber is always set when we reach this branch
      const label =
        resolvedSprintNumber !== null
          ? `#${resolvedSprintNumber}`
          : action.sprintId
      process.stdout.write(
        `Task ${task.identifier} already in sprint ${label}\n`
      )
      return
    }

    if (action.type === 'unbind') {
      // Fetch the old sprint number for display (we only know the id here)
      let oldNumber: number | null = null
      try {
        const sprintRes = await fetch(
          `${base}/api/sprints/${action.oldSprintId}`,
          { headers: { Authorization: `Bearer ${creds.token}` } }
        )
        if (sprintRes.ok) {
          const body = (await sprintRes.json()) as {
            sprint: { number: number }
          }
          oldNumber = body.sprint.number
        }
      } catch {
        // non-critical — we'll fall back to '-'
      }

      let deleteRes: Response
      try {
        deleteRes = await fetch(
          `${base}/api/sprints/${action.oldSprintId}/tasks/${task.id}`,
          {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${creds.token}` },
          }
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
        return 1
      }
      if (!deleteRes.ok) {
        let errMsg = httpFailed('sprint unbind', deleteRes.status)
        try {
          const b = (await deleteRes.json()) as { error?: string }
          if (b.error) errMsg = b.error
        } catch {
          /* ignore */
        }
        console.error(`Error: ${sanitizeField(errMsg)}`)
        return 1
      }

      const oldLabel = oldNumber !== null ? `#${oldNumber}` : action.oldSprintId
      process.stdout.write(
        `Unbound ${task.identifier} from sprint ${oldLabel}\n`
      )
      return
    }

    if (action.type === 'bind') {
      let postRes: Response
      try {
        postRes = await fetch(
          `${base}/api/sprints/${action.newSprintId}/tasks`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${creds.token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ taskId: task.id }),
          }
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
        return 1
      }
      if (!postRes.ok) {
        let errMsg = httpFailed('sprint bind', postRes.status)
        try {
          const b = (await postRes.json()) as { error?: string }
          if (b.error) errMsg = b.error
        } catch {
          /* ignore */
        }
        console.error(`Error: ${sanitizeField(errMsg)}`)
        return 1
      }

      // resolvedSprintNumber is set from the resolveSprintId call above
      const newLabel =
        resolvedSprintNumber !== null
          ? `#${resolvedSprintNumber}`
          : action.newSprintId
      process.stdout.write(`Sprint: - → ${newLabel}\n`)
      return
    }

    if (action.type === 'rebind') {
      // Fetch old sprint number for display (only know id from currentSprintId)
      let oldNumber: number | null = null
      try {
        const oldSprintRes = await fetch(
          `${base}/api/sprints/${action.oldSprintId}`,
          { headers: { Authorization: `Bearer ${creds.token}` } }
        )
        if (oldSprintRes.ok) {
          const b = (await oldSprintRes.json()) as {
            sprint: { number: number }
          }
          oldNumber = b.sprint.number
        }
      } catch {
        // non-critical
      }

      // Step 1: DELETE old sprint binding
      let deleteRes: Response
      try {
        deleteRes = await fetch(
          `${base}/api/sprints/${action.oldSprintId}/tasks/${task.id}`,
          {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${creds.token}` },
          }
        )
      } catch {
        console.error(
          `Task may be in inconsistent sprint state, re-run or check Web UI`
        )
        return 1
      }
      if (!deleteRes.ok) {
        console.error(
          `Task may be in inconsistent sprint state, re-run or check Web UI`
        )
        return 1
      }

      // Step 2: POST new sprint binding
      let postRes: Response
      try {
        postRes = await fetch(
          `${base}/api/sprints/${action.newSprintId}/tasks`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${creds.token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ taskId: task.id }),
          }
        )
      } catch {
        console.error(
          `Task may be in inconsistent sprint state, re-run or check Web UI`
        )
        return 1
      }
      if (!postRes.ok) {
        console.error(
          `Task may be in inconsistent sprint state, re-run or check Web UI`
        )
        return 1
      }

      const oldLabel = oldNumber !== null ? `#${oldNumber}` : '-'
      // resolvedSprintNumber is set from the resolveSprintId call above
      const newLabel =
        resolvedSprintNumber !== null
          ? `#${resolvedSprintNumber}`
          : action.newSprintId
      process.stdout.write(`Sprint: ${oldLabel} → ${newLabel}\n`)
      return
    }
  }

  // If only --sprint was given (no PATCH fields), we've already returned above.
  // But if --sprint wasn't given and PATCH succeeded, we returned inside the
  // PATCH success block. This path is unreachable in normal operation.
  return
}
