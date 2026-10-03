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
import {
  isBackfillEligible,
  isStewardBinding,
} from '@/lib/attribution/backfill-eligibility'
import { parseChildSessionId } from '@/lib/session/child-session-id'
import { logger } from '@/lib/logger'

/**
 * LUM-932 P2: recompute a session family's TaskAttributionSegment rows
 * (spec section 3 precedence). Session.taskId is never touched. Since P3 the
 * recompute also backfills HookEvent.taskId of UNATTACHED, non-steward
 * sessions from their inferred segments (moving open crossings along), in one
 * versioned transaction per family.
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
  'NOTIFICATION',
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

/**
 * Stored signals win; historical rows fall back to the payload unless it was
 * pruned. A root task-notification prompt whose signals were stored before
 * NOTIFICATION existed also gets that one signal from its payload (R2).
 */
function rawSignalsOf(e: FamilyEvent): AttributionSignal[] {
  const fromPayload = (): AttributionSignal[] =>
    e.payloadPrunedAt == null && e.payload != null
      ? extractAttributionSignals(e.type, e.payload)
      : []
  if (e.attributionSignals == null) return fromPayload()
  const stored = Array.isArray(e.attributionSignals)
    ? (e.attributionSignals as unknown[]).filter(isSignal)
    : []
  if (
    e.type !== 'USER_PROMPT_SUBMIT' ||
    stored.some(s => s.kind === 'NOTIFICATION')
  )
    return stored
  return [...fromPayload().filter(s => s.kind === 'NOTIFICATION'), ...stored]
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
    const notifiedAgentId = signals.find(
      s => s.kind === 'NOTIFICATION'
    )?.agentId
    return {
      sessionId: event.sessionId,
      type: event.type,
      at: event.createdAt,
      signals: resolved,
      ...(notifiedAgentId ? { notifiedAgentId } : {}),
    }
  })

  const segments = attributeTurns({
    rootSessionId: root.id,
    sessions: family.sessions.map(s => ({
      id: s.id,
      parentSessionId: s.parentSessionId,
      agentId: s.agentId,
      // R2: a notification from an attached subagent follows its binding.
      ...(opts.ignoreExplicit ? {} : { taskId: s.taskId }),
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
async function computeFamilyRows(rootId: string): Promise<{
  familyIds: string[]
  rows: SegmentRow[]
  version: number
  eventTaskChanges: EventTaskChange[]
  /** POST_TOOL_USE event ids of the family (detector replay candidates). */
  postToolEventIds: ReadonlySet<string>
} | null> {
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
      version: shape.attributionVersion,
      // Explicit sessions' events are retagged at attach time, never here.
      eventTaskChanges: [],
      postToolEventIds: new Set(),
    }
  }

  const family = await attributionRepository.loadFamily(rootId)
  if (!family || family.sessions.length === 0) return null
  // LUM-640 / LUM-932 P3: a STEWARD family is governance work, never inferred
  // onto a task — no INFERRED segments (stale ones are cleared), explicit
  // child rows only.
  const steward = isStewardBinding(family.sessions[0])
  const { segments, lastRootTurn } = steward
    ? {
        segments: [] as InferredSegment[],
        lastRootTurn: Math.max(
          0,
          rootPromptCount(family, family.sessions[0]!.id) - 1
        ),
      }
    : await inferFamily(family, { ignoreExplicit: false })
  const input: ExplicitInput = {
    workspaceId: family.workspaceId,
    sessions: family.sessions,
    firstEventAt: firstEventTimes(family),
    lastRootTurn,
  }
  const rows = [
    ...segments.map(s => inferredRow(family, s)),
    ...explicitChildRows(input),
  ]
  return {
    familyIds: family.sessions.map(s => s.id),
    rows,
    version: family.attributionVersion,
    eventTaskChanges: eventTaskAssignments(family, rows),
    postToolEventIds: new Set(
      family.events.filter(e => e.type === 'POST_TOOL_USE').map(e => e.id)
    ),
  }
}

export interface EventTaskChange {
  eventId: string
  taskId: string | null
}

/** The INFERRED segment of `segments` covering `at` (`toAt` exclusive). */
function taskAt(segments: SegmentRow[] | undefined, at: Date): string | null {
  const ms = at.getTime()
  const hit = segments?.find(
    s => s.fromAt.getTime() <= ms && (s.toAt === null || ms < s.toAt.getTime())
  )
  return hit?.taskId ?? null
}

/** The segment of `segments` ending exactly at `at` (a clipped child's end). */
function taskEndingAt(
  segments: SegmentRow[] | undefined,
  at: Date
): string | null {
  const ms = at.getTime()
  return segments?.find(s => s.toAt?.getTime() === ms)?.taskId ?? null
}

/**
 * LUM-932 P3: event backfill from the family's computed rows. Only events of
 * sessions `isBackfillEligible` admits (unbound, parent unbound, neither a
 * STEWARD) — the commit re-checks the same predicate in its transaction. An
 * event's target is its own session's INFERRED segment covering `createdAt`;
 * a child without a covering segment of its own (clipped child segments end
 * at its last event) falls back to its parent's; a child event no segment
 * covers at all (a child entirely before the root's first segment: its
 * clipped head row ends AT its last event) takes its own segment ending
 * there; otherwise null. Only events whose target differs from their current
 * taskId are returned.
 *
 * Known residual race (follow-up): a boundary detector running detached
 * after a recompute may still create a crossing on the event's
 * pre-recompute task; that crossing is moved only by a later recompute that
 * changes the event's task again.
 */
export function eventTaskAssignments(
  family: SessionFamily,
  rows: SegmentRow[]
): EventTaskChange[] {
  const byId = new Map(family.sessions.map(s => [s.id, s]))
  const eligible = new Set<string>()
  for (const s of family.sessions) {
    const parent = s.parentSessionId ? byId.get(s.parentSessionId) : undefined
    if (isBackfillEligible(s, parent)) eligible.add(s.id)
  }
  const inferred = new Map<string, SegmentRow[]>()
  for (const r of rows) {
    if (r.source !== 'INFERRED') continue
    const list = inferred.get(r.sessionId)
    if (list) list.push(r)
    else inferred.set(r.sessionId, [r])
  }
  const out: EventTaskChange[] = []
  for (const e of family.events) {
    if (!e.sessionId || !eligible.has(e.sessionId)) continue
    const parentId = byId.get(e.sessionId)?.parentSessionId ?? null
    const own = inferred.get(e.sessionId)
    const target =
      taskAt(own, e.createdAt) ??
      (parentId
        ? (taskAt(inferred.get(parentId), e.createdAt) ??
          taskEndingAt(own, e.createdAt))
        : null)
    if (target !== (e.taskId ?? null))
      out.push({ eventId: e.id, taskId: target })
  }
  return out
}

/** Strong kinds after BRANCH, in the order an event's own signals are tried. */
const PROVISIONAL_ORDER: readonly SignalKind[] = [
  'LUMO_CMD',
  'COMMIT',
  'PR_CREATE',
]

/** Event types whose task follows their PRE_TOOL_USE (same tool_use_id). */
const POST_TOOL_TYPES: ReadonlySet<string> = new Set([
  'POST_TOOL_USE',
  'POST_TOOL_USE_FAILURE',
])

/** How far back a POST event looks for its PRE_TOOL_USE. */
const PRE_TOOL_LOOKBACK_MS = 24 * 60 * 60 * 1000

/**
 * Resolve `signals` (in the given order) to the first live task of the
 * workspace: an identifier through the team/number lookup, a branch without
 * one through its linked PR. At most two queries, none for no signals.
 */
async function firstResolvedTask(
  workspaceId: string,
  signals: AttributionSignal[]
): Promise<string | null> {
  if (signals.length === 0) return null
  const identifiers = new Set<string>()
  const branches = new Set<string>()
  for (const s of signals) {
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
  for (const s of signals) {
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

/**
 * LUM-932 P3: the task an event of an UNATTACHED session belongs to right now,
 * first match wins:
 *   1. the event's own BRANCH signal, resolved (on a task branch, work
 *      belongs to the branch's task — branch ruling C);
 *   2. the open INFERRED segment of the session itself (a subagent first),
 *      else of its parent;
 *   3. the event's other strong signals (task-naming lumo command, [ID]
 *      commit, gh pr create), resolved;
 *   4. for a POST_TOOL_USE(_FAILURE) event, the task its PRE_TOOL_USE (same
 *      `tool_use_id`, same session) was tagged with — so the post-tool
 *      boundary detector runs on the same task the pre-tool event had;
 *   5. the event's PROMPT signal, resolved (only when nothing else applies);
 *   6. null.
 */
export async function provisionalTaskFor(input: {
  workspaceId: string
  sessionId: string
  parentSessionId: string | null
  signals: AttributionSignal[]
  /** HookEventType of the event being recorded. */
  type: string
  /** The payload's `tool_use_id` (POST events look up their PRE by it). */
  toolUseId: string | null
}): Promise<string | null> {
  const { workspaceId, sessionId, parentSessionId, signals, type, toolUseId } =
    input
  const branch = await firstResolvedTask(
    workspaceId,
    signals.filter(s => s.kind === 'BRANCH')
  )
  if (branch) return branch

  const open = await attributionRepository.findOpenSegmentTask(
    workspaceId,
    parentSessionId ? [sessionId, parentSessionId] : [sessionId]
  )
  if (open) return open

  const strong = signals
    .filter(s => STRONG_KINDS.has(s.kind) && s.kind !== 'BRANCH')
    .sort(
      (a, b) =>
        PROVISIONAL_ORDER.indexOf(a.kind) - PROVISIONAL_ORDER.indexOf(b.kind)
    )
  const fromStrong = await firstResolvedTask(workspaceId, strong)
  if (fromStrong) return fromStrong

  if (POST_TOOL_TYPES.has(type) && toolUseId) {
    const pre = await attributionRepository.findPreToolUseTask(
      workspaceId,
      sessionId,
      toolUseId,
      new Date(Date.now() - PRE_TOOL_LOOKBACK_MS)
    )
    if (pre) return pre
  }

  return firstResolvedTask(
    workspaceId,
    signals.filter(s => s.kind === 'PROMPT')
  )
}

export const attributionInternals = { inferFamily }

/** Version conflicts tolerated per recompute before deferring to the next STOP. */
const MAX_CONFLICT_RETRIES = 2

export interface RecomputeResult {
  segments: number
  /** True when the segment rows were rewritten. */
  written: boolean
  eventsUpdated: number
  crossingsMoved: number
  /** The subset of `crossingsMoved` that went to no task. */
  crossingsMovedToNull: number
  /**
   * POST_TOOL_USE events this recompute moved from no task to a task: the
   * boundary detector never ran on them with a task, so the trigger replays
   * it (I1).
   */
  backfilledPostToolEventIds: string[]
  /** Set when every attempt lost the version race; nothing was written. */
  conflict?: true
}

const NOTHING_MOVED = {
  eventsUpdated: 0,
  crossingsMoved: 0,
  crossingsMovedToNull: 0,
  backfilledPostToolEventIds: [] as string[],
}

export const attributionService = {
  /** Recompute every segment of the family containing `sessionId` (root or child id). Null when not found. */
  async recomputeFamily(sessionId: string): Promise<RecomputeResult | null> {
    const rootId = parseChildSessionId(sessionId)?.parentSessionId ?? sessionId
    let segments = 0
    for (let attempt = 0; attempt <= MAX_CONFLICT_RETRIES; attempt++) {
      const plan = await computeFamilyRows(rootId)
      if (!plan) return null
      const { familyIds, rows, version, eventTaskChanges, postToolEventIds } =
        plan
      segments = rows.length

      const existing = await attributionRepository.listFamilySegments(familyIds)
      const unchanged = sameSegments(rows, existing)
      if (unchanged && eventTaskChanges.length === 0) {
        return { segments, written: false, ...NOTHING_MOVED }
      }
      const res = await attributionRepository.commitFamilyAttribution({
        rootSessionId: rootId,
        expectedVersion: version,
        familyIds,
        segments: unchanged ? null : rows,
        eventTaskChanges,
      })
      if (!res.conflict) {
        return {
          segments,
          written: !unchanged,
          eventsUpdated: res.eventsUpdated,
          crossingsMoved: res.crossingsMoved,
          crossingsMovedToNull: res.crossingsMovedToNull,
          backfilledPostToolEventIds: res.changedEvents
            .filter(
              m =>
                m.fromTaskId === null &&
                m.toTaskId !== null &&
                postToolEventIds.has(m.eventId)
            )
            .map(m => m.eventId),
        }
      }
    }
    logger.warn('attribution recompute gave up after version conflicts', {
      rootSessionId: rootId,
      attempts: MAX_CONFLICT_RETRIES + 1,
    })
    return {
      segments,
      written: false,
      ...NOTHING_MOVED,
      conflict: true,
    }
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
