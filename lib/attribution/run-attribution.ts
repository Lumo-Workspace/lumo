/**
 * LUM-932 P4: per-run 'why is this work on this task' read model over
 * TaskAttributionSegment. Pure and client-safe (no server imports) — the
 * task dossier calls summarizeRunAttributions in the browser.
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
export interface DedupedEvidence extends EvidenceView {
  count: number
}
/** Collapse repeated signals by (kind, identifier): first-seen order, the
 *  earliest `at`, and how many times the signal fired. */
export function dedupeEvidence(evidence: EvidenceView[]): DedupedEvidence[] {
  const byKey = new Map<string, DedupedEvidence>()
  for (const e of evidence) {
    const key = `${e.kind}\u0000${e.identifier}`
    const prev = byKey.get(key)
    if (!prev) {
      byKey.set(key, {
        kind: e.kind,
        identifier: e.identifier,
        at: e.at,
        count: 1,
      })
    } else {
      prev.count += 1
      if (Date.parse(e.at) < Date.parse(prev.at)) prev.at = e.at
    }
  }
  return [...byKey.values()]
}

/** Evidence of a group of look-alike subagents: the deduped union with each
 *  entry's count the maximum any one member recorded (not the sum, which
 *  would read as one subagent firing the signal that many times). */
export function mergeGroupEvidence(
  members: EvidenceView[][]
): DedupedEvidence[] {
  const merged = new Map<string, DedupedEvidence>()
  for (const member of members) {
    for (const e of dedupeEvidence(member)) {
      const key = `${e.kind}\u0000${e.identifier}`
      const prev = merged.get(key)
      if (!prev) merged.set(key, e)
      else {
        prev.count = Math.max(prev.count, e.count)
        if (Date.parse(e.at) < Date.parse(prev.at)) prev.at = e.at
      }
    }
  }
  return [...merged.values()]
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
  /** An INFERRED subagent with no signal of its own rode its parent's
   *  attribution; `evidence` then holds the parent's covering signals. */
  followsParent: boolean
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
    .sort(
      (a, b) =>
        a.fromTurn - b.fromTurn || a.fromAt.getTime() - b.fromAt.getTime()
    )
    .map(toSegmentView)
  const byChild = new Map<string, RunSubagentView>()
  const childFromAt = new Map<string, number>()
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
        followsParent: false,
      })
      childFromAt.set(r.sessionId, r.fromAt.getTime())
      continue
    }
    if (CONFIDENCE_RANK[r.confidence] < CONFIDENCE_RANK[cur.confidence]) {
      cur.confidence = r.confidence
      cur.source = r.source
    }
    cur.evidence.push(...evidence)
  }
  const subagents = [...byChild.values()]
  for (const sub of subagents) {
    if (sub.source !== 'INFERRED' || sub.evidence.length > 0) continue
    const inherited = parentEvidenceAt(
      segments,
      childFromAt.get(sub.sessionId)!
    )
    if (inherited.length === 0) continue
    sub.evidence = inherited
    sub.followsParent = true
  }
  const approximate =
    mode === 'INFERRED' ||
    segments.some(s => s.source === 'INFERRED') ||
    subagents.some(s => s.source === 'INFERRED')
  return { mode, segments, subagents, approximate }
}

/** Evidence of the root segment(s) covering `at`; all root evidence when
 *  none covers it. */
function parentEvidenceAt(
  segments: RunSegmentView[],
  at: number
): EvidenceView[] {
  const covering = segments.filter(
    s =>
      Date.parse(s.fromAt) <= at &&
      (s.toAt === null || Date.parse(s.toAt) >= at)
  )
  const fromCovering = covering.flatMap(s => s.evidence)
  if (fromCovering.length > 0) return [...fromCovering]
  return segments.flatMap(s => s.evidence)
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

/**
 * The weakest confidence across a run's segments and subagents — the badge
 * suffix the web shows on an auto-detected run ("Auto-detected · Medium
 * confidence"). null when the run has neither. Shared with the CLI run report
 * (LUM-1188).
 */
export function weakestConfidence(
  attribution: Pick<RunAttribution, 'segments' | 'subagents'>
): AttributionConfidenceName | null {
  const all = [...attribution.segments, ...attribution.subagents]
  if (all.length === 0) return null
  return all.some(x => x.confidence === 'MEDIUM') ? 'MEDIUM' : 'HIGH'
}

export interface SubagentGroup {
  sub: RunSubagentView
  count: number
  members: EvidenceView[][]
}

/**
 * Collapse look-alike subagents (same type, source, confidence, follows-parent
 * flag and deduped signal set) into one row with a count, first-seen order.
 * The web attribution panel and the CLI run report render these groups.
 */
export function groupSubagents(subagents: RunSubagentView[]): SubagentGroup[] {
  const groups = new Map<string, SubagentGroup>()
  for (const sub of subagents) {
    const signature = dedupeEvidence(sub.evidence)
      .map(e => `${e.kind}:${e.identifier}`)
      .sort()
      .join(',')
    const key = [
      sub.agentType ?? '',
      sub.source,
      sub.confidence,
      sub.followsParent,
      signature,
    ].join('|')
    const g = groups.get(key)
    if (g) {
      g.count += 1
      g.members.push(sub.evidence)
    } else {
      groups.set(key, { sub, count: 1, members: [sub.evidence] })
    }
  }
  return [...groups.values()]
}
