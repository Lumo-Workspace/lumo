/**
 * LUM-932 P4: per-run 'why is this work on this task' read model over
 * TaskAttributionSegment. Pure.
 */
export type AttributionSourceName =
  | 'SESSION_ATTACH'
  | 'SUBAGENT_ATTACH'
  | 'INHERITED'
  | 'INFERRED'
export type AttributionConfidenceName = 'EXPLICIT' | 'HIGH' | 'MEDIUM'
export type SignalKindName =
  | 'BRANCH'
  | 'LUMO_CMD'
  | 'COMMIT'
  | 'PR_CREATE'
  | 'PROMPT'
  | 'GIT_HINT'
  | 'AGENT_PROMPT'

export interface EvidenceView {
  kind: SignalKindName
  identifier: string
  at: string
}
export interface RunSegmentView {
  source: AttributionSourceName
  confidence: AttributionConfidenceName
  fromTurn: number
  toTurn: number
  fromAt: string
  toAt: string | null
  evidence: EvidenceView[]
}
export interface RunSubagentView {
  sessionId: string
  agentType: string | null
  source: AttributionSourceName
  confidence: AttributionConfidenceName
  evidence: EvidenceView[]
}
/** EXPLICIT = the run's session is bound to this task; INFERRED = the
 *  session is unbound and auto-detected onto it; HOST = the session is
 *  unbound and only hosts subagents that attached this task themselves. */
export type RunAttributionMode = 'EXPLICIT' | 'INFERRED' | 'HOST'
export interface RunAttribution {
  mode: RunAttributionMode
  segments: RunSegmentView[]
  subagents: RunSubagentView[]
  /** Some of this run's work on the task was auto-detected (not bound). */
  approximate: boolean
}
export interface TaskSegmentRow {
  sessionId: string
  parentSessionId: string | null
  agentType: string | null
  source: AttributionSourceName
  confidence: AttributionConfidenceName
  fromTurn: number
  toTurn: number
  fromAt: Date
  toAt: Date | null
  evidence: unknown
}

const SIGNAL_KINDS = new Set<SignalKindName>([
  'BRANCH',
  'LUMO_CMD',
  'COMMIT',
  'PR_CREATE',
  'PROMPT',
  'GIT_HINT',
  'AGENT_PROMPT',
])
const CONFIDENCE_RANK: Record<AttributionConfidenceName, number> = {
  EXPLICIT: 3,
  HIGH: 2,
  MEDIUM: 1,
}

export function parseEvidence(raw: unknown): EvidenceView[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap(e => {
    if (!e || typeof e !== 'object') return []
    const { kind, identifier, at } = e as Record<string, unknown>
    if (typeof kind !== 'string' || !SIGNAL_KINDS.has(kind as SignalKindName))
      return []
    if (typeof identifier !== 'string' || typeof at !== 'string') return []
    return [{ kind: kind as SignalKindName, identifier, at }]
  })
}

function toSegmentView(r: TaskSegmentRow): RunSegmentView {
  return {
    source: r.source,
    confidence: r.confidence,
    fromTurn: r.fromTurn,
    toTurn: r.toTurn,
    fromAt: r.fromAt.toISOString(),
    toAt: r.toAt ? r.toAt.toISOString() : null,
    evidence: parseEvidence(r.evidence),
  }
}

export function buildRunAttribution({
  runSessionId,
  mode,
  rows,
}: {
  runSessionId: string
  mode: RunAttributionMode
  rows: TaskSegmentRow[]
}): RunAttribution {
  const segments = rows
    .filter(r => r.sessionId === runSessionId)
    .sort((a, b) => a.fromTurn - b.fromTurn || a.fromAt.getTime() - b.fromAt.getTime())
    .map(toSegmentView)
  const byChild = new Map<string, RunSubagentView>()
  const childRows = rows
    .filter(r => r.parentSessionId === runSessionId)
    .sort((a, b) => a.fromAt.getTime() - b.fromAt.getTime())
  for (const r of childRows) {
    const cur = byChild.get(r.sessionId)
    const evidence = parseEvidence(r.evidence)
    if (!cur) {
      byChild.set(r.sessionId, {
        sessionId: r.sessionId,
        agentType: r.agentType,
        source: r.source,
        confidence: r.confidence,
        evidence,
      })
      continue
    }
    if (CONFIDENCE_RANK[r.confidence] < CONFIDENCE_RANK[cur.confidence]) {
      cur.confidence = r.confidence
      cur.source = r.source
    }
    cur.evidence.push(...evidence)
  }
  const subagents = [...byChild.values()]
  const approximate =
    mode === 'INFERRED' ||
    segments.some(s => s.source === 'INFERRED') ||
    subagents.some(s => s.source === 'INFERRED')
  return { mode, segments, subagents, approximate }
}

export interface RunAttributionSummary {
  explicit: number
  inferred: number
  approximate: boolean
}

export function summarizeRunAttributions(
  attributions: (RunAttribution | null)[]
): RunAttributionSummary {
  let explicit = 0
  let inferred = 0
  let approximate = false
  for (const a of attributions) {
    if (!a) continue
    if (a.mode === 'INFERRED') inferred++
    else explicit++
    if (a.approximate) approximate = true
  }
  return { explicit, inferred, approximate }
}
