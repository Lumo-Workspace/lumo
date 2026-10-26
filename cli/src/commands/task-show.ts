import { EXIT_USAGE } from '../lib/exit-codes'
import { NONE, fmtDay } from '../lib/format'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import {
  TASK_DESCRIPTION_FENCE,
  TASK_DESCRIPTION_PREAMBLE,
  fenceUntrustedText,
} from '../../../shared/src/untrusted-fence'
import { errAuth, errHttp, errNotLoggedIn } from '../lib/errors'
import {
  fieldLines,
  type Field,
  type LayoutOptions,
} from '../lib/report-layout'
import { colorEnabled, enumColor, heading, terminalWidth } from '../lib/ui'
import {
  detailEnvelope,
  emitJson,
  stripInternalFields,
} from '../lib/json-output'
import { guardJsonBlock } from '../lib/json-guard'
import { resolveBoundTaskIdentifier } from '../lib/resolve-bound-task'
import { bufferSink, type OutputSink } from '../lib/output-sink'
import { fetchTaskContext, printTaskContext } from './task-context'
import { taskCommentList } from './task-comment-list'
import { taskHistory } from './task-history'
import { taskScans } from './task-scans'
import { taskRuns } from './task-runs'
import { outcomeShow } from './outcome'
import { taskLineage } from './task-lineage'
import { taskDepsList } from './task-deps'

interface ActorView {
  type: 'member' | 'agent'
  label: string
  email: string | null
}

/** `Alice <alice@example.com>` for a member, the bare name for an agent. */
function actorLabel(actor: ActorView | null | undefined): string {
  if (!actor) return NONE
  const label = sanitizeField(actor.label)
  return actor.email && actor.type === 'member'
    ? `${label} <${sanitizeField(actor.email)}>`
    : label
}

/** LUM-1283: the creating member, always a user. */
interface MemberView {
  name: string
  email: string | null
}

/** `Alice <alice@example.com>`, the bare name without an email, `-` if none. */
function memberLabel(member: MemberView | null | undefined): string {
  if (!member) return NONE
  const name = sanitizeField(member.name)
  return member.email ? `${name} <${sanitizeField(member.email)}>` : name
}

interface ShowResponse {
  task: {
    id: string
    identifier: string
    title: string
    status: string
    priority: string
    description: string | null
    descriptionMarkdown?: string | null
    url: string
    project: { id: string; name: string }
    assignee: ActorView | null
    /**
     * LUM-1283: the creating member (always a user); null when unrecorded
     * (automation, older tasks). Optional so an older server still renders.
     */
    createdBy?: MemberView | null
    /** LUM-821 — optional so an older server still renders. */
    dueDate?: string | null
    /** LUM-1286 — likely originals from the background duplicate check;
     *  optional so an older server still renders. */
    possibleDuplicates?: Array<{
      identifier: string
      title: string
      status: string
      score: number | null
    }>
  }
}

/**
 * LUM-1286: the "possible duplicate" block under the fields — each likely
 * original with the two commands that rule on it, ready to copy.
 */
function possibleDuplicateLines(task: ShowResponse['task']): string[] {
  const dups = task.possibleDuplicates ?? []
  if (dups.length === 0) return []
  const lines = [
    '',
    '⚠ Possible duplicate — the duplicate check thinks this task repeats:',
  ]
  for (const d of dups) {
    const match =
      d.score === null ? '' : ` · ${Math.round(d.score * 100)}% match`
    lines.push(
      `  ${sanitizeField(d.identifier)}  "${sanitizeField(d.title)}"  ${sanitizeField(d.status)}${match}`,
      `    Confirm duplicate:  lumo task dep confirm ${task.identifier} ${sanitizeField(d.identifier)}`,
      `    Not a duplicate:    lumo task dep dismiss ${task.identifier} ${sanitizeField(d.identifier)}`
    )
  }
  return lines
}

/**
 * Render task detail: the `<id>  <title>` header (bold on a TTY), then
 * `Label:  value` rows padded to the widest label (LUM-1090, the LUM-1091
 * grammar; the URL is never wrapped). The description follows in its own
 * `<untrusted-task-description>` fence (LUM-998): member-authored text,
 * wrapper tags defanged and directive-shaped content flagged at the head —
 * printed verbatim, never re-wrapped (it is Markdown).
 */
export function formatTaskShow(
  task: ShowResponse['task'],
  opts: LayoutOptions & { description?: boolean } = {}
): string {
  const lines: string[] = [
    heading(`${task.identifier}  ${sanitizeField(task.title)}`, {
      color: opts.color === true,
    }),
  ]
  const fields: Field[] = [
    { label: 'Status', value: enumColor(task.status, opts.color === true) },
    {
      label: 'Priority',
      value: enumColor(task.priority, opts.color === true),
    },
    { label: 'Project', value: sanitizeField(task.project.name) },
    { label: 'Assignee', value: actorLabel(task.assignee) },
  ]
  // LUM-1283: absent (older server) → no row; null → unrecorded.
  if (task.createdBy !== undefined) {
    fields.push({ label: 'Created by', value: memberLabel(task.createdBy) })
  }
  if (task.dueDate) fields.push({ label: 'Due', value: fmtDay(task.dueDate) })
  fields.push({ label: 'URL', value: task.url, whole: true })
  lines.push(...fieldLines(fields, 0, opts))
  lines.push(...possibleDuplicateLines(task))
  // `--full` prints the description once, inside the context body.
  const description =
    opts.description === false
      ? ''
      : fenceUntrustedText(
          TASK_DESCRIPTION_FENCE,
          TASK_DESCRIPTION_PREAMBLE,
          task.descriptionMarkdown ?? task.description ?? ''
        )
  if (description) {
    lines.push('')
    lines.push(description)
  }
  return lines.join('\n')
}

/** LUM-1233: the aspects `task show` can add, in print order. */
export const TASK_SHOW_ASPECTS = [
  'comments',
  'history',
  'scans',
  'runs',
  'outcome',
  'lineage',
  'deps',
] as const
export type TaskShowAspect = (typeof TASK_SHOW_ASPECTS)[number]

export interface TaskShowOptions {
  json?: boolean | undefined
  /** Alone: the whole task context (formerly `task context`). With an
   *  aspect flag: that aspect's long form. */
  full?: boolean | undefined
  /** The context with every memory body (formerly `task context --full`). */
  memory?: boolean | undefined
  comments?: boolean | undefined
  history?: boolean | undefined
  scans?: boolean | undefined
  runs?: boolean | undefined
  outcome?: boolean | undefined
  lineage?: boolean | undefined
  deps?: boolean | undefined
  /** `--scans`: every pushed head's scan. */
  all?: boolean | undefined
  /** `--lineage`: append the usage-signal health section. */
  signal?: boolean | undefined
  /** `--comments` / `--history` paging. */
  limit?: string | undefined
  cursor?: string | undefined
}

/** The aspects selected by `opts`, in print order. */
export function selectedAspects(opts: TaskShowOptions): TaskShowAspect[] {
  return TASK_SHOW_ASPECTS.filter(a => opts[a] === true)
}

/** Usage problems of a flag combination (null = fine). Pure. */
export function taskShowUsageError(opts: TaskShowOptions): string | null {
  const aspects = selectedAspects(opts)
  if (opts.limit !== undefined || opts.cursor !== undefined) {
    const paged = aspects.filter(a => a === 'comments' || a === 'history')
    if (paged.length !== 1 || aspects.length !== 1)
      return '--limit / --cursor page one aspect: pass them with exactly one of --comments or --history'
  }
  if (opts.all && !opts.scans) return '--all goes with --scans'
  if (opts.signal && !opts.lineage) return '--signal goes with --lineage'
  return null
}

/** Whether the old `task context` body is printed. */
export function showsContext(opts: TaskShowOptions): boolean {
  return (
    opts.memory === true ||
    (opts.full === true && selectedAspects(opts).length === 0)
  )
}

function runAspect(
  aspect: TaskShowAspect,
  identifier: string,
  opts: TaskShowOptions,
  out: OutputSink
): Promise<number | void> {
  const json = opts.json === true
  const full = opts.full === true
  switch (aspect) {
    case 'comments':
      return taskCommentList(
        identifier,
        { full, limit: opts.limit, cursor: opts.cursor, json },
        out
      )
    case 'history':
      return taskHistory(
        identifier,
        { limit: opts.limit, cursor: opts.cursor, json },
        out
      )
    case 'scans':
      return taskScans(identifier, { all: opts.all, full, json }, out)
    case 'runs':
      return taskRuns(identifier, { full, json }, out)
    case 'outcome':
      return outcomeShow(identifier, { json }, out)
    case 'lineage':
      return taskLineage(identifier, { signal: opts.signal, json }, out)
    case 'deps':
      return taskDepsList(identifier, { json }, out)
  }
}

export async function taskShow(
  identifierArg: string | undefined,
  opts: TaskShowOptions = {}
): Promise<number | void> {
  const usageError = taskShowUsageError(opts)
  if (usageError) {
    console.error(`Error: ${usageError}`)
    return EXIT_USAGE
  }

  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }

  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)
  const identifier =
    identifierArg ?? (await resolveBoundTaskIdentifier(base, creds.token))
  if (!identifier) {
    console.error(
      'Error: no task given and this session is not attached\n' +
        'Hint: pass a task ref, or run `lumo session attach <LUM-N>`.'
    )
    return EXIT_USAGE
  }
  const url = `${base}/api/tasks/by-identifier/${encodeURIComponent(identifier)}`

  let res: Response
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${creds.token}` },
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
  if (res.status === 404) {
    console.error(
      `Error: task ${identifier} not found in workspace ${creds.workspaceSlug}`
    )
    return 1
  }
  if (!res.ok) {
    console.error(errHttp('task show', res.status))
    return 1
  }

  const data = (await res.json()) as ShowResponse
  const t = data.task
  const aspects = selectedAspects(opts)
  const context = showsContext(opts)
    ? await fetchTaskContext(
        apiUrl,
        creds.token,
        t.identifier,
        creds.workspaceSlug
      )
    : null
  if (context && !context.ok) return context.code

  if (opts.json) {
    // `ref` first (J-3); the description gets the same guard as the text
    // view's fence body. LUM-1233: each aspect is one more key of the one
    // envelope (AF-2), holding that aspect's own `--json` payload.
    const envelope = detailEnvelope(
      'task',
      stripInternalFields({
        ref: t.identifier,
        ...t,
        description: guardJsonBlock(t.description),
        ...(t.descriptionMarkdown !== undefined
          ? { descriptionMarkdown: guardJsonBlock(t.descriptionMarkdown) }
          : {}),
      })
    )
    if (context?.ok) {
      // The `Next:` advice is a text-mode hint, not context data.
      const payload: Partial<typeof context.data> = { ...context.data }
      delete payload.nextSteps
      envelope.context = stripInternalFields(payload)
    }
    for (const aspect of aspects) {
      const buf = bufferSink()
      const code = await runAspect(aspect, t.identifier, opts, buf)
      if (typeof code === 'number' && code !== 0) return code
      envelope[aspect] = JSON.parse(buf.text())
    }
    emitJson(envelope)
    return
  }

  const layout = {
    width: terminalWidth(),
    tty: Boolean(process.stdout.isTTY),
    color: colorEnabled(),
  }
  process.stdout.write(
    formatTaskShow(t, { ...layout, description: !context }) + '\n'
  )
  if (context?.ok) {
    process.stdout.write('\n')
    await printTaskContext(context.data, { memory: opts.memory })
  }
  for (const aspect of aspects) {
    process.stdout.write('\n')
    const code = await runAspect(aspect, t.identifier, opts, process.stdout)
    if (typeof code === 'number' && code !== 0) return code
  }
}
