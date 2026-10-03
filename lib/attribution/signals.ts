import {
  matchAllTaskIdentifiers,
  matchTaskIdentifier,
} from '../../shared/src/task-identifier'
import {
  splitSegmentsQuoteAware,
  unwrapShellWrapper,
  verbOf,
} from '@/lib/boundary-crossing/command-shape'
import { AGENT_ID_RE } from '@/lib/session/child-session-id'

/**
 * LUM-932 P2: task-identification signals (spec section 6.2), extracted from
 * ONE hook payload at record time and stored on HookEvent.attributionSignals.
 * Pure; never throws. Identifiers are raw (`LUM-12`) - resolving them to a
 * task of the workspace happens at recompute time.
 */
export type SignalKind =
  | 'BRANCH'
  | 'LUMO_CMD'
  | 'COMMIT'
  | 'PR_CREATE'
  | 'PROMPT'
  | 'GIT_HINT'
  | 'AGENT_PROMPT'
  /**
   * A root prompt that is a background subagent's `<task-notification>`,
   * carrying the reporting agent id. Not task evidence (never strong, weak or
   * segment evidence): the engine lets the turn follow that subagent.
   */
  | 'NOTIFICATION'

export interface AttributionSignal {
  kind: SignalKind
  identifier?: string
  branch?: string
  agentId?: string
}

export const STRONG_KINDS: ReadonlySet<SignalKind> = new Set<SignalKind>([
  'BRANCH',
  'LUMO_CMD',
  'COMMIT',
  'PR_CREATE',
])
/** Kinds allowed to open a new segment (spec section 6.3 step 3). */
export const SWITCH_KINDS: ReadonlySet<SignalKind> = new Set<SignalKind>([
  ...STRONG_KINDS,
  'PROMPT',
])

/** Opening tag of a background task's completion notice in a root prompt. */
export const TASK_NOTIFICATION_MARKER = '<task-notification>'
const TASK_ID_RE = /<task-id>\s*([^<\s]{1,64})\s*<\/task-id>/

/** The `<task-id>` of a `<task-notification>` prompt, when it is an agent id. */
function notificationAgentId(prompt: string): string | null {
  const start = prompt.indexOf(TASK_NOTIFICATION_MARKER)
  if (start < 0) return null
  const id = TASK_ID_RE.exec(prompt.slice(start))?.[1]
  return id && AGENT_ID_RE.test(id) ? id : null
}

/** Hard cap on signals stored per event. */
export const MAX_SIGNALS_PER_EVENT = 50
/**
 * A prompt naming more than this many distinct ids is a list / backlog paste,
 * not evidence of the task being worked on: it yields no signals.
 */
export const MAX_PROMPT_IDENTIFIERS = 3

/** Distinct ids of a prompt, or [] when it names too many to be evidence. */
function promptIdentifiers(prompt: string): string[] {
  const ids = matchAllTaskIdentifiers(prompt, MAX_PROMPT_IDENTIFIERS + 1)
  return ids.length > MAX_PROMPT_IDENTIFIERS ? [] : ids
}

function field(payload: unknown, ...path: string[]): unknown {
  let cur: unknown = payload
  for (const k of path) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[k]
  }
  return cur
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null

function segmentsOf(command: string, depth = 0): string[] {
  const out: string[] = []
  for (const raw of splitSegmentsQuoteAware(command)) {
    const seg = raw.trim()
    if (!seg) continue
    const inner = depth < 3 ? unwrapShellWrapper(seg) : null
    if (inner != null) out.push(...segmentsOf(inner, depth + 1))
    else out.push(seg)
  }
  return out
}

function commandSignals(command: string): AttributionSignal[] {
  const out: AttributionSignal[] = []
  for (const seg of segmentsOf(command)) {
    const { verb, rest } = verbOf(seg)
    const tail = rest.join(' ')
    if (verb === 'lumo') {
      // `lumo session attach` creates the explicit binding; it is not evidence.
      if (rest[0] === 'session') continue
      const id = matchTaskIdentifier(tail)
      if (id) out.push({ kind: 'LUMO_CMD', identifier: id })
    } else if (verb === 'git' && rest[0] === 'commit') {
      for (const m of seg.matchAll(/\[([A-Za-z]{1,10}-\d+)\]/g)) {
        const id = matchTaskIdentifier(m[1]!)
        if (id) out.push({ kind: 'COMMIT', identifier: id })
      }
    } else if (verb === 'gh' && rest[0] === 'pr' && rest[1] === 'create') {
      for (const id of matchAllTaskIdentifiers(tail)) {
        out.push({ kind: 'PR_CREATE', identifier: id })
      }
    }
  }
  return out
}

export function extractAttributionSignals(
  type: string,
  payload: unknown
): AttributionSignal[] {
  try {
    const out: AttributionSignal[] = []
    const branch = str(field(payload, '_lumo_branch'))
    if (branch && branch !== 'main' && branch !== 'master') {
      const id = matchTaskIdentifier(branch)
      out.push(
        id
          ? { kind: 'BRANCH', identifier: id, branch }
          : { kind: 'BRANCH', branch }
      )
    }
    const tool = str(field(payload, 'tool_name'))
    if (type === 'PRE_TOOL_USE' && tool === 'Bash') {
      const command = str(field(payload, 'tool_input', 'command'))
      if (command) out.push(...commandSignals(command))
    }
    if (type === 'USER_PROMPT_SUBMIT') {
      const prompt = str(field(payload, 'prompt'))
      if (prompt) {
        const agentId = notificationAgentId(prompt)
        if (agentId) out.push({ kind: 'NOTIFICATION', agentId })
        for (const id of promptIdentifiers(prompt)) {
          out.push({ kind: 'PROMPT', identifier: id })
        }
      }
    }
    if (type === 'SESSION_START') {
      const hint = str(field(payload, '_lumo_git_task'))
      const id = hint ? matchTaskIdentifier(hint) : null
      if (id) out.push({ kind: 'GIT_HINT', identifier: id })
    }
    if (type === 'POST_TOOL_USE' && (tool === 'Agent' || tool === 'Task')) {
      const agentId = str(field(payload, 'tool_response', 'agentId'))
      const prompt = str(field(payload, 'tool_input', 'prompt'))
      if (agentId && AGENT_ID_RE.test(agentId) && prompt) {
        for (const id of promptIdentifiers(prompt)) {
          out.push({ kind: 'AGENT_PROMPT', identifier: id, agentId })
        }
      }
    }
    return out.slice(0, MAX_SIGNALS_PER_EVENT)
  } catch {
    return []
  }
}
