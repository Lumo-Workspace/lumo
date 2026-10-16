import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveBoundTaskIdentifier } from '../lib/resolve-bound-task'
import { sanitizeField } from '../lib/sanitize'
import { errAuth, errNotLoggedIn } from '../lib/errors'
import {
  fetchActorNames,
  fetchCrossingRecords,
  type CrossingEditChange,
  type CrossingRecord,
} from '../lib/crossing-records'
import {
  bulletLines,
  commandLine,
  fieldLines,
  sectionHeading,
  reportWidth,
  wrapLines,
  type Field,
  type LayoutOptions,
} from '../lib/report-layout'
import { colorEnabled, terminalWidth } from '../lib/ui'

export interface CrossingListOptions {
  /** Also list the dispositioned history (default: open rows only). */
  all?: boolean
  /** Emit the raw server rows as JSON instead of prose. */
  json?: boolean
}

export interface CrossingListFormatOptions extends LayoutOptions {
  /** Include dispositioned rows. */
  all?: boolean
  /** actorId → display name, for "who ruled". Missing ids print as the id. */
  actorNames?: Map<string, string>
}

/** Shown wherever the response carries no value for a field. */
const NONE = '-'
/** Lines of each diff side printed before eliding the rest. */
export const DIFF_SIDE_LINES = 12
/** A single diff line is cut at this many characters. */
const DIFF_LINE_CAP = 160

/**
 * Untrusted free text (detail, notes, rule text, explanations …) as ONE line:
 * control characters stripped (ANSI / CSI injection — LUM-346), then every
 * run of whitespace — newlines and tabs included — collapsed to a space so an
 * embedded newline cannot forge a field row of its own.
 */
export function oneLine(value: string | null | undefined): string {
  if (value == null) return ''
  return sanitizeField(value).replace(/\s+/g, ' ').trim()
}

function orNone(value: string | null | undefined): string {
  const v = oneLine(value)
  return v === '' ? NONE : v
}

/** One diff side as `<marker> line` rows: sanitized per line, tabs expanded,
 *  each line capped, at most {@link DIFF_SIDE_LINES} lines then an elision. */
export function diffSideLines(text: string, marker: '-' | '+'): string[] {
  const lines = sanitizeField(text).replace(/\t/g, '  ').split('\n')
  const shown = lines.slice(0, DIFF_SIDE_LINES).map(l => {
    const capped =
      l.length > DIFF_LINE_CAP ? `${l.slice(0, DIFF_LINE_CAP)}…` : l
    return `${marker} ${capped}`.trimEnd()
  })
  const rest = lines.length - shown.length
  if (rest > 0) shown.push(`${marker} … (${rest} more line(s))`)
  return shown
}

/** The `Diff:` row of a crossing — the inline edit summary the web panel
 *  shows for display-safe categories, else an explicit `-`. */
export function diffField(change: CrossingEditChange | null): Field {
  if (!change) return { label: 'Diff', value: NONE }
  const link = change.prFileUrl ?? change.prUrl
  const linkLine = link ? [`PR: ${oneLine(link)}`] : []
  if (change.unavailable || change.kind == null) {
    return {
      label: 'Diff',
      value: `unavailable (${orNone(change.unavailable)})`,
      sub: linkLine,
    }
  }
  const sub: string[] = []
  if (change.kind === 'edit' && change.oldText != null)
    sub.push(...diffSideLines(change.oldText, '-'))
  if (change.newText != null) sub.push(...diffSideLines(change.newText, '+'))
  if (change.truncated) sub.push('(content was truncated for display)')
  sub.push(...linkLine)
  return {
    label: 'Diff',
    value: change.kind === 'edit' ? 'edit (old → new)' : 'write (content)',
    sub,
  }
}

function actorLabel(
  actorId: string | null,
  names: Map<string, string> | undefined
): string {
  if (!actorId) return NONE
  const name = names?.get(actorId)
  return name ? `${oneLine(name)} (${oneLine(actorId)})` : oneLine(actorId)
}

function stateLabel(c: CrossingRecord): string {
  if (c.disposition != null) return oneLine(c.disposition)
  if (c.blocking) return 'OPEN · blocks DONE'
  return c.advisory ? 'OPEN · advisory' : 'OPEN · does not block DONE'
}

function attributionValue(c: CrossingRecord): string {
  const a = c.attribution
  const agent = a.agent
    ? a.worktreeBranch
      ? `${a.agent}/${a.worktreeBranch}`
      : a.agent
    : NONE
  return oneLine(
    `model=${a.model ?? NONE} · agent=${agent} · session=${
      a.sessionId ? a.sessionId.slice(0, 8) : NONE
    }`
  )
}

/** The fact rows of one crossing — every field the panel shows, `-` when the
 *  response carries none. */
export function crossingFields(
  c: CrossingRecord,
  names?: Map<string, string>,
  opts: LayoutOptions = {}
): Field[] {
  // Sub-rows print 4 columns in (fields at 2, subs one level deeper).
  const subOpts = { ...opts, width: reportWidth(opts) - 4 }
  const occurrences =
    c.occurrenceCount == null
      ? NONE
      : `×${c.occurrenceCount} · last seen ${orNone(c.lastSeenAt)}`
  const rule =
    c.policyRuleText || c.policyRuleRef
      ? `${c.policyRuleRef ? `[${oneLine(c.policyRuleRef)}] ` : ''}${orNone(
          c.policyRuleText
        )}`
      : NONE
  const fields: Field[] = [
    { label: 'State', value: stateLabel(c) },
    { label: 'Detail', value: orNone(c.detail) },
    { label: 'Detected', value: orNone(c.detectedAt) },
    { label: 'Occurrences', value: occurrences },
    {
      label: 'Reversible',
      value: c.reversible == null ? NONE : c.reversible ? 'yes' : 'no',
    },
    { label: 'Attribution', value: attributionValue(c) },
    { label: 'Rule', value: rule },
    diffField(c.editChange),
    {
      label: 'Turn intent',
      value: orNone(c.agentContext ?? c.editChange?.agentTurnContext),
    },
    { label: 'System explanation', value: orNone(c.systemExplanation) },
    {
      label: 'Agent explanations',
      value:
        c.explanations.length === 0
          ? NONE
          : `${c.explanations.length} (agent self-report, unverified)`,
      sub: c.explanations.flatMap(e => bulletLines(oneLine(e), 0, subOpts)),
    },
    {
      label: 'Re-judge',
      value: c.rejudge
        ? `${orNone(c.rejudge.reason)} — ${orNone(c.rejudge.evidence)}`
        : NONE,
    },
    {
      label: 'AI triage',
      value:
        c.triageProbability == null
          ? NONE
          : `P(legit)=${c.triageProbability.toFixed(2)} (${orNone(
              c.triageModel
            )})`,
    },
    {
      label: 'Remediation',
      value: c.remediationTask
        ? `${oneLine(c.remediationTask.identifier)} ${orNone(
            c.remediationTask.title
          )} (${orNone(c.remediationTask.status)}${
            c.remediationTask.remediated ? ', remediated' : ''
          })`
        : NONE,
    },
  ]
  if (c.disposition != null) {
    const change = c.lastDispositionChange
    fields.push(
      { label: 'Ruled by', value: actorLabel(c.dispositionedById, names) },
      { label: 'Ruled at', value: orNone(c.dispositionedAt) },
      { label: 'Channel', value: orNone(c.dispositionChannel) },
      { label: 'Note', value: orNone(c.dispositionNote) },
      {
        label: 'Changed',
        value: change
          ? `${orNone(change.from ?? 'OPEN')} → ${orNone(
              change.to ?? 'OPEN'
            )} by ${actorLabel(change.actorId, names)} at ${orNone(
              change.at
            )} via ${orNone(change.channel)}`
          : NONE,
      },
      {
        label: 'Suppression rule',
        value: c.suppressionRule
          ? `${oneLine(c.suppressionRule.id.slice(0, 8))}${
              c.suppressionRule.reason
                ? ` — ${oneLine(c.suppressionRule.reason)}`
                : ''
            } · ${
              c.suppressionRule.revokedAt
                ? `revoked ${oneLine(c.suppressionRule.revokedAt)}`
                : 'active'
            }`
          : NONE,
      }
    )
  }
  if (c.rawPurged)
    fields.push({
      label: 'Retention',
      value: 'original text was not retained (replaced by a description)',
    })
  return fields
}

/**
 * `lumo crossing list` prose — a pure function of the records (no clock, no
 * env): a summary line, then one block per crossing. Every untrusted string is
 * sanitized here, at the print boundary.
 */
export function formatCrossingList(
  taskIdentifier: string,
  records: CrossingRecord[],
  opts: CrossingListFormatOptions = {}
): string {
  const open = records.filter(c => c.disposition == null)
  const ruled = records.filter(c => c.disposition != null)
  const shown = opts.all ? records : open
  const blocking = open.filter(c => c.blocking).length
  const task = oneLine(taskIdentifier)
  const lines: string[] = [
    `Boundary crossings on ${task}: ${open.length} open (${blocking} blocking DONE), ${ruled.length} dispositioned`,
  ]
  if (!opts.all && ruled.length > 0)
    lines.push(
      ...wrapLines(
        `${ruled.length} dispositioned crossing(s) not shown — add --all for the ruling history.`,
        0,
        opts
      )
    )
  if (shown.length === 0) {
    lines.push('', opts.all ? 'No crossings recorded.' : 'No open crossings.')
    return lines.join('\n') + '\n'
  }
  for (const c of shown) {
    lines.push(
      ...sectionHeading(
        `${oneLine(c.ref)} [${c.severity}] ${oneLine(c.category)}`,
        opts
      ),
      ...fieldLines(crossingFields(c, opts.actorNames, opts), 2, opts)
    )
  }
  if (open.length > 0) {
    lines.push(
      '',
      ...bulletLines(
        "Ruling is the user's call — relay each open crossing, then (exit-4 envelope; never self-approve):",
        0,
        opts
      ),
      commandLine(
        'lumo crossing disposition <ref> --false-positive | --confirmed',
        2
      )
    )
  }
  return lines.join('\n') + '\n'
}

/**
 * `lumo crossing list [task] [--all] [--json]` (LUM-1187) — read-only: the
 * task's boundary crossings with every detail the web Record panel shows;
 * `--all` adds the dispositioned history. Defaults to the session-bound task.
 */
export async function crossingList(
  identifier: string | undefined,
  options: CrossingListOptions = {}
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
          'Run `lumo crossing list <LUM-N>`, or bind first with `lumo session attach <LUM-N>`.'
      )
      return 1
    }
  }

  const result = await fetchCrossingRecords(base, creds.token, taskId)
  if (result.status === 'unauthorized') {
    console.error(errAuth())
    return 1
  }
  if (result.status === 'not_found') {
    console.error(
      `Error: task ${sanitizeField(taskId)} not found in workspace ${
        creds.workspaceSlug ?? ''
      }`
    )
    return 1
  }
  if (result.status === 'error') {
    console.error(
      `Error: could not read boundary crossings (${sanitizeField(
        result.reason
      )})`
    )
    return 1
  }

  if (options.json) {
    // JSON.stringify escapes control characters, so raw rows are safe to emit.
    const crossings = options.all
      ? result.raw
      : result.raw.filter(
          r =>
            !(
              typeof r === 'object' &&
              r !== null &&
              (r as { disposition?: unknown }).disposition != null
            )
        )
    process.stdout.write(
      JSON.stringify(
        { task: taskId, gateEnabled: result.gateEnabled, crossings },
        null,
        2
      ) + '\n'
    )
    return
  }

  const needsNames =
    options.all === true &&
    result.crossings.some(
      c => c.dispositionedById || c.lastDispositionChange?.actorId
    )
  const actorNames = needsNames
    ? await fetchActorNames(base, creds.token)
    : new Map<string, string>()
  process.stdout.write(
    formatCrossingList(taskId, result.crossings, {
      all: options.all === true,
      actorNames,
      width: terminalWidth(),
      color: colorEnabled(),
    })
  )
}
