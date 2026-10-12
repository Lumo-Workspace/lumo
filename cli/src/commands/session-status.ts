import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import {
  isCodexShell,
  noSessionMessage,
  resolveSessionId,
} from '../lib/session-id'
import { codexHooksSilentWarning } from '../lib/codex-hooks'
import { errAuth, errHttp, errNotLoggedIn } from '../lib/errors'

interface StatusResponse {
  exists: boolean
  sessionId: string
  startedAt: string
  lastActivityAt: string
  eventCount: number
  taskIdentifier: string | null
  taskTitle: string | null
  /** LUM-640: STEWARD when milestone-bound. Absent on older servers. */
  role?: 'IMPLEMENTATION' | 'STEWARD'
  /** LUM-640: the bound milestone's name for STEWARD sessions. Absent on older servers. */
  milestoneName?: string | null
  /** LUM-932 P4: set on a subagent's child session. Absent on older servers. */
  parentSessionId?: string | null
  /** LUM-932 P4: absent on older servers. */
  attribution?: Attribution
}

type SourceName =
  | 'SESSION_ATTACH'
  | 'SUBAGENT_ATTACH'
  | 'INHERITED'
  | 'INFERRED'

interface Attribution {
  segments: {
    taskIdentifier: string
    source: SourceName
    confidence: string
    fromTurn: number
    toTurn: number
    evidence: { kind: string; identifier: string; at: string }[]
  }[]
  subagents: {
    sessionId: string
    agentType: string | null
    tasks: { taskIdentifier: string; source: SourceName; confidence: string }[]
  }[]
  unattributed: boolean
  approximate: boolean
}

const SOURCE_WORD: Record<SourceName, string> = {
  SESSION_ATTACH: 'attached',
  SUBAGENT_ATTACH: 'subagent attach',
  INHERITED: 'inherited',
  INFERRED: 'auto-detected',
}

function sourceWord(source: SourceName | undefined): string {
  if (typeof source !== 'string') return '?'
  return SOURCE_WORD[source] ?? sanitizeField(source.toLowerCase())
}

function evidenceText(
  evidence: Attribution['segments'][number]['evidence'] | undefined
): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const e of Array.isArray(evidence) ? evidence : []) {
    if (typeof e?.kind !== 'string' || typeof e?.identifier !== 'string') {
      continue
    }
    const text = sanitizeField(
      `${e.kind.toLowerCase().replace(/_/g, ' ')} ${e.identifier}`
    )
    if (seen.has(text)) continue
    seen.add(text)
    out.push(text)
    if (out.length === 3) break
  }
  return out.join(', ')
}

/** A malformed (non-string) task identifier from the server prints as '?'. */
function identifierText(value: unknown): string {
  return typeof value === 'string' ? sanitizeField(value) : '?'
}

/** Stored turns are 0-based; print them 1-based, matching the web. */
function turnText(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? String(value + 1)
    : '?'
}

function segmentLine(seg: Attribution['segments'][number]): string {
  const turns =
    seg.fromTurn === seg.toTurn
      ? `turn ${turnText(seg.fromTurn)}`
      : `turns ${turnText(seg.fromTurn)}–${turnText(seg.toTurn)}`
  const confidence: unknown = seg.confidence
  const how =
    seg.source === 'INFERRED' && typeof confidence === 'string'
      ? `${sourceWord(seg.source)} · ${sanitizeField(confidence.toLowerCase())}`
      : sourceWord(seg.source)
  const ev = evidenceText(seg.evidence)
  return `    ${identifierText(seg.taskIdentifier)}  ${turns}  ${how}${ev ? ` (${ev})` : ''}\n`
}

/** The rendered parts of one subagent line: `<type> (<id6>)  <tail>`. */
function subagentParts(sub: Attribution['subagents'][number]): {
  type: string
  shortId: string
  tail: string
} {
  const sessionId: unknown = sub.sessionId
  const agentId =
    typeof sessionId === 'string'
      ? sessionId.slice(sessionId.lastIndexOf(':') + 1)
      : ''
  const subTasks = Array.isArray(sub.tasks) ? sub.tasks : []
  const tail = subTasks.length
    ? subTasks
        .map(
          t => `${identifierText(t?.taskIdentifier)} ${sourceWord(t?.source)}`
        )
        .join(', ')
    : 'follows parent'
  const type = sanitizeField(
    typeof sub.agentType === 'string' ? sub.agentType : 'subagent'
  )
  return { type, shortId: sanitizeField(agentId.slice(-6)), tail }
}

/**
 * One line per distinct `<type>  <tail>` (first-seen order): a lone subagent
 * keeps its `(id6)`, a group prints `<type> ×N` instead of N identical lines.
 */
function subagentLines(subagents: Attribution['subagents']): string {
  const groups = new Map<
    string,
    { parts: ReturnType<typeof subagentParts>; count: number }
  >()
  for (const sub of subagents) {
    const parts = subagentParts(sub)
    const key = `${parts.type}\u0000${parts.tail}`
    const g = groups.get(key)
    if (g) g.count += 1
    else groups.set(key, { parts, count: 1 })
  }
  let out = ''
  for (const { parts, count } of groups.values()) {
    const label =
      count === 1
        ? `${parts.type} (${parts.shortId})`
        : `${parts.type} ×${count}`
    out += `    ${label}  ${parts.tail}\n`
  }
  return out
}

function subagentOfLine(data: StatusResponse): string {
  return data.parentSessionId
    ? `  Subagent of: ${sanitizeField(data.parentSessionId)}\n`
    : ''
}

/** Lines appended after the binding lines. Empty for old servers. */
function attributionBlock(data: StatusResponse, bound: boolean): string {
  const a = data.attribution
  if (!a || typeof a !== 'object') return ''
  const segments = Array.isArray(a.segments) ? a.segments : []
  const subagents = Array.isArray(a.subagents) ? a.subagents : []
  let out = ''
  if (segments.length > 0) {
    out += '  Attribution:\n' + segments.map(segmentLine).join('')
  } else if (a.unattributed && !bound) {
    out +=
      '  Attribution: none yet (no task signal) — it will be auto-detected from branch, commits and lumo commands, or run lumo session attach <LUM-N>.\n'
  }
  if (subagents.length > 0) {
    out += '  Subagents:\n' + subagentLines(subagents)
  }
  if (a.approximate) {
    out +=
      '  ⚠ Some work was auto-detected — time and cost may be inaccurate. Run `lumo session attach <LUM-N>` for exact numbers.\n'
  }
  return out
}

export async function sessionStatus(): Promise<number | void> {
  const sessionId = await resolveSessionId({ write: false })
  if (!sessionId) {
    console.error(noSessionMessage('lumo session status'))
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }

  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const url = `${trimTrailingSlash(apiUrl)}/api/sessions/${encodeURIComponent(sessionId)}`

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
    // Session row only materializes after the first hook event or an
    // explicit `session attach`. Until then there's nothing to report.
    process.stdout.write(
      `Session ${sessionId} has no server-side state yet (no task bound, no hook events).\n` +
        `Run \`lumo session attach <LUM-N>\` to bind it.\n`
    )
    if (isCodexShell()) console.error(codexHooksSilentWarning())
    return
  }
  if (!res.ok) {
    console.error(errHttp('session status', res.status))
    return 1
  }

  const data = (await res.json()) as StatusResponse
  // LUM-1051: a bound Codex session with no events = hooks not trusted.
  if (isCodexShell() && data.eventCount === 0) {
    console.error(codexHooksSilentWarning())
  }
  // LUM-640: the steward form — milestone-bound governance session.
  if (data.role === 'STEWARD' && data.milestoneName) {
    process.stdout.write(
      `Session ${sessionId}\n` +
        `  Role:      STEWARD (governance — plan & accept only)\n` +
        `  Bound to:  milestone "${sanitizeField(data.milestoneName)}"\n` +
        `  Events:    ${data.eventCount}\n`
    )
    return
  }
  if (data.taskIdentifier && data.taskTitle) {
    process.stdout.write(
      `Session ${sessionId}\n` +
        subagentOfLine(data) +
        `  Bound to:  ${data.taskIdentifier} "${sanitizeField(data.taskTitle)}"\n` +
        `  Events:    ${data.eventCount}\n` +
        attributionBlock(data, true)
    )
  } else {
    process.stdout.write(
      `Session ${sessionId}\n` +
        subagentOfLine(data) +
        `  Bound to:  (no task)\n` +
        `  Events:    ${data.eventCount}\n` +
        attributionBlock(data, false)
    )
  }
}
