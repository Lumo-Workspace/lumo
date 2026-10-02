import {
  ATTRIBUTION_COMPUTE_VERSION,
  attributionRepository,
  type FamilyEvent,
  type FamilySession,
  type SegmentRow,
  type SessionFamily,
  type StoredSegment,
} from '@/lib/repositories/attribution.repository'
import {
  attributeTurns,
  type EngineEvent,
  type InferredSegment,
  type ResolvedSignal,
} from '@/lib/attribution/attribute-turns'
import {
  extractAttributionSignals,
  STRONG_KINDS,
  type AttributionSignal,
  type SignalKind,
} from '@/lib/attribution/signals'
import { miscRepository } from '@/lib/repositories/misc.repository'
import {
  compareInferenceToBinding,
  type SessionVerdict,
} from '@/lib/attribution/inference-eval'
import type { VerifyApiKeyResult } from '@/lib/services/auth.service'
import { canonicalTaskIdentifier } from '@/lib/attribution/identifier'
import { parseChildSessionId } from '@/lib/session/child-session-id'

/**
 * LUM-932 P2: recompute a session family's TaskAttributionSegment rows
 * (spec section 3 precedence). Observe-only mode — segments are written, nothing
 * gates on them, and HookEvent.taskId / Session.taskId are never touched.
 *
 *   1. Root explicitly bound → SESSION_ATTACH for the root, one explicit
 *      segment per bound child; the engine does not run and no event rows
 *      are loaded (light family shape only).
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
  if (e.payloadPrunedAt == null && e.payload != null)
    return extractAttributionSignals(e.type, e.payload)
  return []
}

function rootPromptCount(family: SessionFamily, rootId: string): number {
  return family.events.filter(
    e => e.sessionId === rootId && e.type === 'USER_PROMPT_SUBMIT'
  ).length
}

/** First event time per session id (events are createdAt-ascending). */
function firstEventTimes(family: SessionFamily): Map<string, Date> {
  const out = new Map<string, Date>()
  for (const e of family.events) {
    if (e.sessionId && !out.has(e.sessionId)) out.set(e.sessionId, e.createdAt)
  }
  return out
}

/** What explicit rows need from a family, from either load path. */
interface ExplicitInput {
  workspaceId: string
  sessions: FamilySession[]
  firstEventAt: Map<string, Date>
  lastRootTurn: number
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
      const canon = s.identifier ? canonicalTaskIdentifier(s.identifier) : null
      if (canon) identifiers.add(canon)
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
        const canon = canonicalTaskIdentifier(s.identifier)
        const taskId = canon ? byIdentifier.get(canon) : undefined
        if (!canon || !taskId) continue
        resolved.push({
          kind: s.kind,
          taskId,
          identifier: canon,
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
  input: ExplicitInput,
  session: FamilySession,
  taskId: string,
  source: SegmentRow['source']
): SegmentRow {
  return {
    workspaceId: input.workspaceId,
    sessionId: session.id,
    taskId,
    fromTurn: 0,
    toTurn: input.lastRootTurn,
    fromAt: input.firstEventAt.get(session.id) ?? session.startedAt,
    toAt: null,
    source,
    confidence: 'EXPLICIT',
    evidence: [],
    computeVersion: ATTRIBUTION_COMPUTE_VERSION,
  }
}

function explicitChildRows(input: ExplicitInput): SegmentRow[] {
  const rows: SegmentRow[] = []
  const root = input.sessions[0]!
  for (const child of input.sessions.slice(1)) {
    // Un-attached subagents inherit an explicitly bound root (spec section 3).
    const taskId = child.taskId ?? root.taskId
    if (!taskId) continue
    const source =
      child.taskId && child.bindingSource === 'ATTACH'
        ? 'SUBAGENT_ATTACH'
        : 'INHERITED'
    rows.push(explicitRow(input, child, taskId, source))
  }
  return rows
}

/** JSON with object keys sorted, so jsonb key reordering compares equal. */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const obj = v as Record<string, unknown>
    return `{${Object.keys(obj)
      .sort()
      .filter(k => obj[k] !== undefined)
      .map(k => `${JSON.stringify(k)}:${stableJson(obj[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v ?? null)
}

function comparableKey(r: SegmentRow | StoredSegment): string {
  return stableJson({
    sessionId: r.sessionId,
    taskId: r.taskId,
    fromTurn: r.fromTurn,
    toTurn: r.toTurn,
    fromAt: r.fromAt.getTime(),
    toAt: r.toAt ? r.toAt.getTime() : null,
    source: r.source,
    confidence: r.confidence,
    computeVersion: r.computeVersion,
    evidence: r.evidence,
  })
}

/** Order-insensitive equality of computed rows and stored segments. */
function sameSegments(rows: SegmentRow[], stored: StoredSegment[]): boolean {
  if (rows.length !== stored.length) return false
  const a = rows.map(comparableKey).sort()
  const b = stored.map(comparableKey).sort()
  return a.every((k, i) => k === b[i])
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

export interface InferenceEvalResult {
  sessionsEvaluated: number
  turns: number
  correct: number
  wrong: number
  unlabeled: number
  sessionCorrect: number
  sessionWrong: number
  sessionUnlabeled: number
  computeVersion: number
  days: number
}

/** Most recently active attached sessions re-inferred per eval call. */
const EVAL_SESSION_CAP = 50
const EVAL_CONCURRENCY = 4
const DAY_MS = 86_400_000

/**
 * The family's segment rows: explicit rows from the light shape for a bound
 * root, otherwise the engine over the full family. Null when not found.
 */
async function computeFamilyRows(
  rootId: string
): Promise<{ familyIds: string[]; rows: SegmentRow[] } | null> {
  const shape = await attributionRepository.loadBoundFamilyShape(rootId)
  if (shape) {
    const root = shape.sessions[0]!
    const input: ExplicitInput = {
      workspaceId: shape.workspaceId,
      sessions: shape.sessions,
      firstEventAt: shape.firstEventAt,
      lastRootTurn: Math.max(0, shape.rootPromptCount - 1),
    }
    return {
      familyIds: shape.sessions.map(s => s.id),
      rows: [
        explicitRow(input, root, root.taskId!, 'SESSION_ATTACH'),
        ...explicitChildRows(input),
      ],
    }
  }

  const family = await attributionRepository.loadFamily(rootId)
  if (!family || family.sessions.length === 0) return null
  const { segments, lastRootTurn } = await inferFamily(family, {
    ignoreExplicit: false,
  })
  const input: ExplicitInput = {
    workspaceId: family.workspaceId,
    sessions: family.sessions,
    firstEventAt: firstEventTimes(family),
    lastRootTurn,
  }
  return {
    familyIds: family.sessions.map(s => s.id),
    rows: [
      ...segments.map(s => inferredRow(family, s)),
      ...explicitChildRows(input),
    ],
  }
}

/** Strong kinds in the order an event's own signals are tried provisionally. */
const PROVISIONAL_ORDER: readonly SignalKind[] = [
  'BRANCH',
  'LUMO_CMD',
  'COMMIT',
  'PR_CREATE',
]

/**
 * LUM-932 P3: the task an event of an UNATTACHED session belongs to right now:
 * the open inferred segment of the session itself (a subagent first), else of
 * its parent; else the first strong signal of this very event (branch,
 * task-naming lumo command, [ID] commit, gh pr create) resolved in the
 * workspace (branch without an id → linked PR); else null.
 * At most one segment query plus two resolution queries (none without a
 * strong signal).
 */
export async function provisionalTaskFor(input: {
  workspaceId: string
  sessionId: string
  parentSessionId: string | null
  signals: AttributionSignal[]
}): Promise<string | null> {
  const { workspaceId, sessionId, parentSessionId, signals } = input
  const open = await attributionRepository.findOpenSegmentTask(
    workspaceId,
    parentSessionId ? [sessionId, parentSessionId] : [sessionId]
  )
  if (open) return open

  const strong = signals
    .filter(s => STRONG_KINDS.has(s.kind))
    .sort(
      (a, b) =>
        PROVISIONAL_ORDER.indexOf(a.kind) - PROVISIONAL_ORDER.indexOf(b.kind)
    )
  if (strong.length === 0) return null

  const identifiers = new Set<string>()
  const branches = new Set<string>()
  for (const s of strong) {
    const canon = s.identifier ? canonicalTaskIdentifier(s.identifier) : null
    if (canon) identifiers.add(canon)
    else if (s.kind === 'BRANCH' && s.branch) branches.add(s.branch)
  }
  const [byIdentifier, byBranch] = await Promise.all([
    identifiers.size > 0
      ? attributionRepository.resolveIdentifiers(workspaceId, [...identifiers])
      : Promise.resolve(new Map<string, string>()),
    branches.size > 0
      ? attributionRepository.taskIdsForBranches(workspaceId, [...branches])
      : Promise.resolve(new Map<string, string>()),
  ])

  for (const s of strong) {
    const canon = s.identifier ? canonicalTaskIdentifier(s.identifier) : null
    const taskId = canon
      ? byIdentifier.get(canon)
      : s.kind === 'BRANCH' && s.branch
        ? byBranch.get(s.branch)
        : undefined
    if (taskId) return taskId
  }
  return null
}

export const attributionInternals = { inferFamily }

export const attributionService = {
  /** Recompute every segment of the family containing `sessionId` (root or child id). Null when not found. */
  async recomputeFamily(
    sessionId: string
  ): Promise<{ segments: number; written: boolean } | null> {
    const rootId = parseChildSessionId(sessionId)?.parentSessionId ?? sessionId
    const rows = await computeFamilyRows(rootId)
    if (!rows) return null
    const { familyIds } = rows

    const existing = await attributionRepository.listFamilySegments(familyIds)
    if (sameSegments(rows.rows, existing)) {
      return { segments: rows.rows.length, written: false }
    }
    await attributionRepository.replaceFamilySegments(familyIds, rows.rows)
    return { segments: rows.rows.length, written: true }
  },

  /**
   * Read-only: re-infer each of the caller's explicitly attached root sessions
   * while ignoring the explicit binding, and score the result against it.
   */
  async inferenceEval({
    identity,
    days,
  }: {
    identity: VerifyApiKeyResult
    days: number
  }): Promise<InferenceEvalResult> {
    const memberId = await miscRepository.findMemberIdForHook(
      identity.user.id,
      identity.workspace.id
    )
    if (!memberId) {
      throw Object.assign(new Error('Not a workspace member'), { status: 403 })
    }
    const since = new Date(Date.now() - days * DAY_MS)
    const ids = await attributionRepository.listExplicitRootSessionsForMember(
      memberId,
      since,
      EVAL_SESSION_CAP
    )
    const result: InferenceEvalResult = {
      sessionsEvaluated: 0,
      turns: 0,
      correct: 0,
      wrong: 0,
      unlabeled: 0,
      sessionCorrect: 0,
      sessionWrong: 0,
      sessionUnlabeled: 0,
      computeVersion: ATTRIBUTION_COMPUTE_VERSION,
      days,
    }
    const verdictKey: Record<
      SessionVerdict,
      'sessionCorrect' | 'sessionWrong' | 'sessionUnlabeled'
    > = {
      correct: 'sessionCorrect',
      wrong: 'sessionWrong',
      unlabeled: 'sessionUnlabeled',
    }

    const evalOne = async (id: string): Promise<void> => {
      const family = await attributionRepository.loadFamily(id)
      const root = family?.sessions[0]
      if (!family || !root || !root.taskId) return
      const { segments, lastRootTurn } = await inferFamily(family, {
        ignoreExplicit: true,
      })
      const cmp = compareInferenceToBinding({
        boundTaskId: root.taskId,
        turnCount: lastRootTurn + 1,
        inferred: segments.filter(s => s.sessionId === root.id),
      })
      result.sessionsEvaluated++
      result.turns += cmp.turns
      result.correct += cmp.correct
      result.wrong += cmp.wrong
      result.unlabeled += cmp.unlabeled
      result[verdictKey[cmp.sessionVerdict]]++
    }

    let next = 0
    const worker = async (): Promise<void> => {
      while (next < ids.length) {
        const id = ids[next++]!
        await evalOne(id)
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(EVAL_CONCURRENCY, ids.length) }, worker)
    )
    return result
  },
}
