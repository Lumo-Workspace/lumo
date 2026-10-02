import {
  ATTRIBUTION_COMPUTE_VERSION,
  attributionRepository,
  type FamilyEvent,
  type FamilySession,
  type SegmentRow,
  type SessionFamily,
} from '@/lib/repositories/attribution.repository'
import {
  attributeTurns,
  type EngineEvent,
  type InferredSegment,
  type ResolvedSignal,
} from '@/lib/attribution/attribute-turns'
import {
  extractAttributionSignals,
  type AttributionSignal,
  type SignalKind,
} from '@/lib/attribution/signals'
import { parseChildSessionId } from '@/lib/session/child-session-id'

/**
 * LUM-932 P2: recompute a session family's TaskAttributionSegment rows
 * (spec section 3 precedence). Observe-only mode — segments are written, nothing
 * gates on them, and HookEvent.taskId / Session.taskId are never touched.
 *
 *   1. Root explicitly bound → SESSION_ATTACH for the root, one explicit
 *      segment per bound child; the engine does not run.
 *   2. Root unbound → resolve signals, run the engine, write INFERRED
 *      segments; explicitly bound children get their explicit segment instead.
 */

const SIGNAL_KINDS: ReadonlySet<string> = new Set<SignalKind>([
  'BRANCH',
  'LUMO_CMD',
  'COMMIT',
  'PR_CREATE',
  'PROMPT',
  'GIT_HINT',
  'AGENT_PROMPT',
])

function isSignal(v: unknown): v is AttributionSignal {
  if (!v || typeof v !== 'object') return false
  const s = v as Record<string, unknown>
  return (
    typeof s.kind === 'string' &&
    SIGNAL_KINDS.has(s.kind) &&
    (s.identifier === undefined || typeof s.identifier === 'string') &&
    (s.branch === undefined || typeof s.branch === 'string') &&
    (s.agentId === undefined || typeof s.agentId === 'string')
  )
}

/** Stored signals win; historical rows fall back to the payload unless it was pruned. */
function rawSignalsOf(e: FamilyEvent): AttributionSignal[] {
  if (e.attributionSignals != null) {
    return Array.isArray(e.attributionSignals)
      ? (e.attributionSignals as unknown[]).filter(isSignal)
      : []
  }
  if (e.payloadPrunedAt == null)
    return extractAttributionSignals(e.type, e.payload)
  return []
}

function rootPromptCount(family: SessionFamily, rootId: string): number {
  return family.events.filter(
    e => e.sessionId === rootId && e.type === 'USER_PROMPT_SUBMIT'
  ).length
}

function firstEventAt(family: SessionFamily, session: FamilySession): Date {
  const first = family.events.find(e => e.sessionId === session.id)
  return first?.createdAt ?? session.startedAt
}

export interface FamilyInference {
  segments: InferredSegment[]
  /** Last root turn index: max(0, root prompts - 1). */
  lastRootTurn: number
}

/**
 * Build engine input for a family and run the engine. With `ignoreExplicit`
 * the engine's view is returned for every session (offline eval, Task 8);
 * otherwise segments of explicitly bound sessions are dropped because the
 * caller writes explicit segments for them.
 */
async function inferFamily(
  family: SessionFamily,
  opts: { ignoreExplicit: boolean }
): Promise<FamilyInference> {
  const root = family.sessions[0]!
  const lastRootTurn = Math.max(0, rootPromptCount(family, root.id) - 1)

  const raw = family.events
    .filter(
      (e): e is FamilyEvent & { sessionId: string } => e.sessionId != null
    )
    .map(e => ({ event: e, signals: rawSignalsOf(e) }))

  const identifiers = new Set<string>()
  const branches = new Set<string>()
  for (const { signals } of raw) {
    for (const s of signals) {
      if (s.identifier) identifiers.add(s.identifier)
      else if (s.kind === 'BRANCH' && s.branch) branches.add(s.branch)
    }
  }
  const [byIdentifier, byBranch] = await Promise.all([
    identifiers.size > 0
      ? attributionRepository.resolveIdentifiers(family.workspaceId, [
          ...identifiers,
        ])
      : Promise.resolve(new Map<string, string>()),
    branches.size > 0
      ? attributionRepository.taskIdsForBranches(family.workspaceId, [
          ...branches,
        ])
      : Promise.resolve(new Map<string, string>()),
  ])

  const events: EngineEvent[] = raw.map(({ event, signals }) => {
    const resolved: ResolvedSignal[] = []
    for (const s of signals) {
      if (s.identifier) {
        const taskId = byIdentifier.get(s.identifier)
        if (!taskId) continue
        resolved.push({
          kind: s.kind,
          taskId,
          identifier: s.identifier,
          ...(s.agentId ? { agentId: s.agentId } : {}),
        })
      } else if (s.kind === 'BRANCH' && s.branch) {
        const taskId = byBranch.get(s.branch)
        if (taskId)
          resolved.push({ kind: 'BRANCH', taskId, identifier: s.branch })
      }
    }
    return {
      sessionId: event.sessionId,
      type: event.type,
      at: event.createdAt,
      signals: resolved,
    }
  })

  const segments = attributeTurns({
    rootSessionId: root.id,
    sessions: family.sessions.map(s => ({
      id: s.id,
      parentSessionId: s.parentSessionId,
      agentId: s.agentId,
    })),
    events,
  })
  if (opts.ignoreExplicit) return { segments, lastRootTurn }
  const bound = new Set(family.sessions.filter(s => s.taskId).map(s => s.id))
  return {
    segments: segments.filter(s => !bound.has(s.sessionId)),
    lastRootTurn,
  }
}

function explicitRow(
  family: SessionFamily,
  session: FamilySession,
  taskId: string,
  source: SegmentRow['source'],
  lastRootTurn: number
): SegmentRow {
  return {
    workspaceId: family.workspaceId,
    sessionId: session.id,
    taskId,
    fromTurn: 0,
    toTurn: lastRootTurn,
    fromAt: firstEventAt(family, session),
    toAt: null,
    source,
    confidence: 'EXPLICIT',
    evidence: [],
    computeVersion: ATTRIBUTION_COMPUTE_VERSION,
  }
}

function explicitChildRows(
  family: SessionFamily,
  lastRootTurn: number
): SegmentRow[] {
  const rows: SegmentRow[] = []
  for (const child of family.sessions.slice(1)) {
    if (!child.taskId) continue
    const source =
      child.bindingSource === 'ATTACH' ? 'SUBAGENT_ATTACH' : 'INHERITED'
    rows.push(explicitRow(family, child, child.taskId, source, lastRootTurn))
  }
  return rows
}

function inferredRow(family: SessionFamily, s: InferredSegment): SegmentRow {
  return {
    workspaceId: family.workspaceId,
    sessionId: s.sessionId,
    taskId: s.taskId,
    fromTurn: s.fromTurn,
    toTurn: s.toTurn,
    fromAt: s.fromAt,
    toAt: s.toAt,
    source: 'INFERRED',
    confidence: s.confidence,
    evidence: s.evidence as unknown as SegmentRow['evidence'],
    computeVersion: ATTRIBUTION_COMPUTE_VERSION,
  }
}

export const attributionInternals = { inferFamily }

export const attributionService = {
  /** Recompute every segment of the family containing `sessionId` (root or child id). Null when not found. */
  async recomputeFamily(
    sessionId: string
  ): Promise<{ segments: number } | null> {
    const rootId = parseChildSessionId(sessionId)?.parentSessionId ?? sessionId
    const family = await attributionRepository.loadFamily(rootId)
    if (!family || family.sessions.length === 0) return null
    const root = family.sessions[0]!

    let rows: SegmentRow[]
    if (root.taskId) {
      const lastRootTurn = Math.max(0, rootPromptCount(family, root.id) - 1)
      rows = [
        explicitRow(family, root, root.taskId, 'SESSION_ATTACH', lastRootTurn),
        ...explicitChildRows(family, lastRootTurn),
      ]
    } else {
      const { segments, lastRootTurn } = await inferFamily(family, {
        ignoreExplicit: false,
      })
      rows = [
        ...segments.map(s => inferredRow(family, s)),
        ...explicitChildRows(family, lastRootTurn),
      ]
    }

    await attributionRepository.replaceFamilySegments(
      family.sessions.map(s => s.id),
      rows
    )
    return { segments: rows.length }
  },
}
