import { trimTrailingSlash } from './api'
import {
  blocksDone,
  type CrossingAttribution,
  type CrossingSeverity,
} from './open-crossings'

/**
 * LUM-1187 — the FULL boundary-crossing record of a task as the terminal shows
 * it (`lumo crossing list`): open AND dispositioned rows, with the details the
 * web Record panel renders (ruling, re-disposition trail, edit diff, recurrence,
 * policy rule text, remediation task …). A read-only mirror of
 * `GET /api/tasks/[id]/boundary-crossings` (LUM-435) — every field is narrowed
 * defensively here so an older server that omits one reads as `null` ("not in
 * the response"), never as a fabricated value. Free text stays RAW in this
 * model; the formatter sanitizes at the print boundary.
 */

export interface CrossingEditChange {
  kind: 'edit' | 'write' | null
  oldText: string | null
  newText: string | null
  truncated: boolean
  unavailable: string | null
  prUrl: string | null
  prFileUrl: string | null
  agentTurnContext: string | null
}

export interface CrossingDispositionChange {
  /** null = OPEN. */
  from: string | null
  to: string | null
  actorId: string | null
  at: string | null
  channel: string | null
}

export interface CrossingRemediationTask {
  identifier: string
  title: string
  status: string
  remediated: boolean
}

export interface CrossingSuppressionRule {
  id: string
  reason: string | null
  revokedAt: string | null
}

export interface CrossingRecord {
  id: string
  ref: string
  category: string
  severity: CrossingSeverity
  detail: string
  detectedAt: string | null
  lastSeenAt: string | null
  occurrenceCount: number | null
  /** null = not in the response (unknown). */
  reversible: boolean | null
  advisory: boolean
  /** Whether the server DONE gate counts this row (open rows only). */
  blocking: boolean
  disposition: string | null
  dispositionNote: string | null
  dispositionedAt: string | null
  /** The ruling actor's id (an Actor id, not a member id). */
  dispositionedById: string | null
  dispositionChannel: string | null
  lastDispositionChange: CrossingDispositionChange | null
  remediationTask: CrossingRemediationTask | null
  editChange: CrossingEditChange | null
  attribution: CrossingAttribution
  explanations: string[]
  rejudge: { reason: string | null; evidence: string | null } | null
  triageProbability: number | null
  triageModel: string | null
  policyRuleRef: string | null
  policyRuleText: string | null
  agentContext: string | null
  systemExplanation: string | null
  rawPurged: boolean
  suppressionRule: CrossingSuppressionRule | null
}

export type CrossingRecordsResult =
  | {
      status: 'ok'
      crossings: CrossingRecord[]
      /** The raw server rows, byte-faithful, for `--json`. */
      raw: unknown[]
      gateEnabled: boolean
    }
  | { status: 'not_found' }
  | { status: 'unauthorized' }
  | { status: 'error'; reason: string }

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null)
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

function normalizeSeverity(s: unknown): CrossingSeverity {
  return s === 'HIGH' || s === 'MEDIUM' || s === 'LOW' ? s : 'LOW'
}

function normalizeAttribution(raw: unknown): CrossingAttribution {
  const a = isObj(raw) ? raw : {}
  return {
    workspaceMemberId: str(a.workspaceMemberId),
    sessionId: str(a.sessionId),
    agent: str(a.agent),
    worktreeBranch: str(a.worktreeBranch),
    model: str(a.model),
  }
}

function normalizeEditChange(raw: unknown): CrossingEditChange | null {
  if (!isObj(raw)) return null
  return {
    kind: raw.kind === 'edit' || raw.kind === 'write' ? raw.kind : null,
    oldText: typeof raw.oldText === 'string' ? raw.oldText : null,
    newText: typeof raw.newText === 'string' ? raw.newText : null,
    truncated: raw.truncated === true,
    unavailable: str(raw.unavailable),
    prUrl: str(raw.prUrl),
    prFileUrl: str(raw.prFileUrl),
    agentTurnContext: str(raw.agentTurnContext),
  }
}

function normalizeChange(raw: unknown): CrossingDispositionChange | null {
  if (!isObj(raw)) return null
  return {
    from: str(raw.from),
    to: str(raw.to),
    actorId: str(raw.actorId),
    at: str(raw.at),
    channel: str(raw.channel),
  }
}

function normalizeRemediation(raw: unknown): CrossingRemediationTask | null {
  if (!isObj(raw)) return null
  const identifier = str(raw.identifier)
  if (!identifier) return null
  return {
    identifier,
    title: typeof raw.title === 'string' ? raw.title : '',
    status: str(raw.status) ?? '',
    remediated: raw.remediated === true,
  }
}

function normalizeSuppressionRule(
  raw: unknown
): CrossingSuppressionRule | null {
  if (!isObj(raw)) return null
  const id = str(raw.id)
  if (!id) return null
  return { id, reason: str(raw.reason), revokedAt: str(raw.revokedAt) }
}

/**
 * Narrow one raw `boundary-crossings` row to the terminal's record. Pure and
 * total: a malformed field degrades to null / its neutral value.
 */
export function normalizeCrossingRecord(
  raw: unknown,
  gateEnabled: boolean
): CrossingRecord {
  const c = isObj(raw) ? raw : {}
  const id = str(c.id) ?? ''
  const severity = normalizeSeverity(c.severity)
  const advisory = c.advisory === true
  const disposition = str(c.disposition)
  const rejudge = isObj(c.rejudge)
    ? { reason: str(c.rejudge.reason), evidence: str(c.rejudge.evidence) }
    : null
  return {
    id,
    ref: str(c.ref) ?? id,
    category: str(c.category) ?? '',
    severity,
    detail: typeof c.detail === 'string' ? c.detail : '',
    detectedAt: str(c.detectedAt),
    lastSeenAt: str(c.lastSeenAt),
    occurrenceCount: num(c.occurrenceCount),
    reversible: bool(c.reversible),
    advisory,
    blocking:
      disposition == null && blocksDone({ advisory, severity }, gateEnabled),
    disposition,
    dispositionNote: str(c.dispositionNote),
    dispositionedAt: str(c.dispositionedAt),
    dispositionedById: str(c.dispositionedById),
    dispositionChannel: str(c.dispositionChannel),
    lastDispositionChange: normalizeChange(c.lastDispositionChange),
    remediationTask: normalizeRemediation(c.remediationTask),
    editChange: normalizeEditChange(c.editChange),
    attribution: normalizeAttribution(c.attribution),
    explanations: (Array.isArray(c.explanations) ? c.explanations : [])
      .map(e => (isObj(e) && typeof e.note === 'string' ? e.note : ''))
      .filter(n => n.length > 0),
    rejudge,
    triageProbability: num(c.triageProbability),
    triageModel: str(c.triageModel),
    policyRuleRef: str(c.policyRuleRef),
    policyRuleText: str(c.policyRuleText),
    agentContext: str(c.agentContext),
    systemExplanation: str(c.systemExplanation),
    rawPurged: c.rawPurged === true,
    suppressionRule: normalizeSuppressionRule(c.suppressionRule),
  }
}

const SEVERITY_RANK: Record<CrossingSeverity, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
}

/**
 * Display order: open rows first (blocking before advisory, then by severity),
 * then the dispositioned history, most recently ruled first.
 */
export function sortCrossingRecords(rows: CrossingRecord[]): CrossingRecord[] {
  return [...rows].sort((a, b) => {
    const aOpen = a.disposition == null
    const bOpen = b.disposition == null
    if (aOpen !== bOpen) return aOpen ? -1 : 1
    if (aOpen) {
      return (
        Number(b.blocking) - Number(a.blocking) ||
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
      )
    }
    return (b.dispositionedAt ?? '').localeCompare(a.dispositionedAt ?? '')
  })
}

/**
 * Fetch every boundary crossing of a task (open + dispositioned) through the
 * existing bearer-readable LUM-435 endpoint. Failure is a value, never thrown:
 * 404 / 401 / transport / parse each map to their own status.
 */
export async function fetchCrossingRecords(
  apiUrl: string,
  token: string,
  taskIdentifier: string
): Promise<CrossingRecordsResult> {
  const url = `${trimTrailingSlash(apiUrl)}/api/tasks/${encodeURIComponent(
    taskIdentifier
  )}/boundary-crossings`
  let res: Response
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  } catch (err) {
    return {
      status: 'error',
      reason: err instanceof Error ? err.message : 'network error',
    }
  }
  if (res.status === 404) return { status: 'not_found' }
  if (res.status === 401) return { status: 'unauthorized' }
  if (!res.ok) return { status: 'error', reason: `HTTP ${res.status}` }
  let data: unknown
  try {
    data = await res.json()
  } catch {
    return { status: 'error', reason: 'invalid response body' }
  }
  const body = isObj(data) ? data : {}
  const raw = Array.isArray(body.crossings) ? (body.crossings as unknown[]) : []
  // Only an explicit `false` disables the gate (LUM-771) — fail closed.
  const gateEnabled = body.gateEnabled !== false
  const crossings = sortCrossingRecords(
    raw.map(r => normalizeCrossingRecord(r, gateEnabled))
  )
  return { status: 'ok', crossings, raw, gateEnabled }
}

/**
 * Best-effort actor id → display name map from the workspace member directory
 * (members carry `actorId`; agents come as `agentActors`), so a ruling reads
 * "by Alice" rather than a bare id. Never throws: any failure yields an empty
 * map and the formatter falls back to the id.
 */
export async function fetchActorNames(
  apiUrl: string,
  token: string
): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  try {
    const res = await fetch(
      `${trimTrailingSlash(apiUrl)}/api/workspaces/members`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!res.ok) return names
    const body = (await res.json()) as unknown
    if (!isObj(body)) return names
    const add = (list: unknown) => {
      if (!Array.isArray(list)) return
      for (const m of list) {
        if (!isObj(m)) continue
        const actorId = str(m.actorId)
        const name = str(m.name)
        if (actorId && name && !names.has(actorId)) names.set(actorId, name)
      }
    }
    add(body.members)
    add(body.agentActors)
  } catch {
    // Names are a nicety — the id still identifies the actor.
  }
  return names
}
