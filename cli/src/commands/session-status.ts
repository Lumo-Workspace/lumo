import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { resolveSessionId } from '../lib/session-id'

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

function sourceWord(source: SourceName): string {
  return SOURCE_WORD[source] ?? sanitizeField(String(source).toLowerCase())
}

function evidenceText(
  evidence: Attribution['segments'][number]['evidence']
): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const e of evidence) {
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

function segmentLine(seg: Attribution['segments'][number]): string {
  const turns =
    seg.fromTurn === seg.toTurn
      ? `turn ${seg.fromTurn}`
      : `turns ${seg.fromTurn}–${seg.toTurn}`
  const how =
    seg.source === 'INFERRED'
      ? `${sourceWord(seg.source)} · ${sanitizeField(seg.confidence.toLowerCase())}`
      : sourceWord(seg.source)
  const ev = evidenceText(seg.evidence)
  return `    ${sanitizeField(seg.taskIdentifier)}  ${turns}  ${how}${ev ? ` (${ev})` : ''}\n`
}

function subagentLine(sub: Attribution['subagents'][number]): string {
  const agentId = sub.sessionId.slice(sub.sessionId.lastIndexOf(':') + 1)
  const tasks = sub.tasks.length
    ? sub.tasks
        .map(t => `${sanitizeField(t.taskIdentifier)} ${sourceWord(t.source)}`)
        .join(', ')
    : 'follows parent'
  const type = sanitizeField(sub.agentType ?? 'subagent')
  return `    ${type} (${sanitizeField(agentId.slice(-6))})  ${tasks}\n`
}

function subagentOfLine(data: StatusResponse): string {
  return data.parentSessionId
    ? `  Subagent of: ${sanitizeField(data.parentSessionId)}\n`
    : ''
}

/** Lines appended after the binding lines. Empty for old servers. */
function attributionBlock(data: StatusResponse, bound: boolean): string {
  const a = data.attribution
  if (!a) return ''
  let out = ''
  if (a.segments.length > 0) {
    out += '  Attribution:\n' + a.segments.map(segmentLine).join('')
  } else if (a.unattributed && !bound) {
    out +=
      '  Attribution: none yet (no task signal) — it will be auto-detected from branch, commits and lumo commands, or run lumo session attach <LUM-N>.\n'
  }
  if (a.subagents.length > 0) {
    out += '  Subagents:\n' + a.subagents.map(subagentLine).join('')
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
    console.error(
      'Error: $CLAUDE_CODE_SESSION_ID is not set.\n' +
        '`lumo session status` must be run inside a Claude Code session.'
    )
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
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
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }
  if (res.status === 404) {
    // Session row only materializes after the first hook event or an
    // explicit `session attach`. Until then there's nothing to report.
    process.stdout.write(
      `Session ${sessionId} has no server-side state yet (no task bound, no hook events).\n` +
        `Run \`lumo session attach <LUM-N>\` to bind it.\n`
    )
    return
  }
  if (!res.ok) {
    console.error(`Error: session status failed (HTTP ${res.status})`)
    return 1
  }

  const data = (await res.json()) as StatusResponse
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
