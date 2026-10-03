import { STRONG_KINDS, type SignalKind } from './signals'

/**
 * LUM-932 P2: pure per-turn attribution engine (spec sections 6.3 / 6.4).
 * Splits a root session into turns (one per root USER_PROMPT_SUBMIT), labels
 * each turn from the root's own signals, folds turns into task segments, and
 * attributes subagent child sessions. No I/O; inputs are never mutated.
 *
 * Production-acceptance rulings (2026-10-02), for root turns not decided by a
 * BRANCH signal (branch ruling C is unchanged):
 *   R1 - a turn whose strong signals name 2+ tasks belongs to the one task its
 *        output (COMMIT / PR_CREATE) names; with no output or output for 2+
 *        tasks it is UNATTRIBUTED: in no segment, and it breaks carry-forward
 *        and leading back-attribution.
 *   R2 - a turn opened by a subagent's `<task-notification>` (and without
 *        strong signals of its own) takes that subagent's task; a subagent
 *        with no task or with 2+ tasks makes it UNATTRIBUTED.
 */
export interface ResolvedSignal {
  kind: SignalKind
  taskId: string
  identifier: string
  agentId?: string
}

export interface EngineEvent {
  sessionId: string
  type: string
  at: Date
  signals: ResolvedSignal[]
  /** A root prompt that is this agent's `<task-notification>` (R2). */
  notifiedAgentId?: string
}

export interface EngineSession {
  id: string
  parentSessionId: string | null
  agentId: string | null
  /** An explicit binding (a notification from it follows this task, R2). */
  taskId?: string | null
}

export interface EvidenceEntry {
  kind: SignalKind
  identifier: string
  at: string
}

export interface InferredSegment {
  sessionId: string
  taskId: string
  fromTurn: number
  toTurn: number
  fromAt: Date
  toAt: Date | null
  confidence: 'HIGH' | 'MEDIUM'
  evidence: EvidenceEntry[]
}

interface TimedSignal {
  signal: ResolvedSignal
  at: Date
  /** Global chronological order, used to break equal-timestamp ties. */
  seq: number
}

/** What a notification turn borrowed from the subagent it follows (R2). */
interface Borrowed {
  evidence: EvidenceEntry[]
  confidence: 'HIGH' | 'MEDIUM'
}

type TurnDecision =
  | {
      kind: 'task'
      taskId: string
      switchCapable: boolean
      borrowed?: Borrowed
    }
  /** No decision of its own: the turn carries the current segment forward. */
  | { kind: 'none' }
  /** R1/R2: in no segment, and nothing carries across it. */
  | { kind: 'unattributed' }

const NONE: TurnDecision = { kind: 'none' }
const UNATTRIBUTED: TurnDecision = { kind: 'unattributed' }
const OUTPUT_KINDS: ReadonlySet<SignalKind> = new Set<SignalKind>([
  'COMMIT',
  'PR_CREATE',
])

const MAX_EVIDENCE = 10

function sortByTime(events: EngineEvent[]): EngineEvent[] {
  return events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.at.getTime() - b.e.at.getTime() || a.i - b.i)
    .map(({ e }) => e)
}

/** Most frequent taskId; ties go to the one seen last. */
function pickTask(signals: TimedSignal[]): string | null {
  const counts = new Map<string, { count: number; lastSeq: number }>()
  for (const s of signals) {
    const prev = counts.get(s.signal.taskId)
    counts.set(s.signal.taskId, {
      count: (prev?.count ?? 0) + 1,
      lastSeq: Math.max(prev?.lastSeq ?? -1, s.seq),
    })
  }
  let best: { taskId: string; count: number; lastSeq: number } | null = null
  for (const [taskId, v] of counts) {
    if (
      !best ||
      v.count > best.count ||
      (v.count === best.count && v.lastSeq > best.lastSeq)
    ) {
      best = { taskId, ...v }
    }
  }
  return best?.taskId ?? null
}

const distinctTasks = (signals: TimedSignal[]): Set<string> =>
  new Set(signals.map(s => s.signal.taskId))

/** R1: a turn's strong signals, decided by its output when they name 2+ tasks. */
function strongDecision(strong: TimedSignal[]): TurnDecision | null {
  if (strong.length === 0) return null
  // Branch ruling C: a turn with a BRANCH signal is decided as it always was.
  const branchDecided = strong.some(s => s.signal.kind === 'BRANCH')
  if (!branchDecided && distinctTasks(strong).size >= 2) {
    const output = distinctTasks(
      strong.filter(s => OUTPUT_KINDS.has(s.signal.kind))
    )
    if (output.size !== 1) return UNATTRIBUTED
    return { kind: 'task', taskId: [...output][0]!, switchCapable: true }
  }
  return { kind: 'task', taskId: pickTask(strong)!, switchCapable: true }
}

function labelTurn(signals: TimedSignal[], turn: number): TurnDecision {
  const strong = strongDecision(
    signals.filter(s => STRONG_KINDS.has(s.signal.kind))
  )
  if (strong) return strong
  const prompt = pickTask(signals.filter(s => s.signal.kind === 'PROMPT'))
  if (prompt) return { kind: 'task', taskId: prompt, switchCapable: true }
  if (turn === 0) {
    const hint = pickTask(signals.filter(s => s.signal.kind === 'GIT_HINT'))
    if (hint) return { kind: 'task', taskId: hint, switchCapable: false }
  }
  return NONE
}

function toEvidence(signals: TimedSignal[]): EvidenceEntry[] {
  return signals.slice(0, MAX_EVIDENCE).map(s => ({
    kind: s.signal.kind,
    identifier: s.signal.identifier,
    at: s.at.toISOString(),
  }))
}

function confidenceOf(signals: TimedSignal[]): 'HIGH' | 'MEDIUM' {
  return signals.some(s => STRONG_KINDS.has(s.signal.kind)) ? 'HIGH' : 'MEDIUM'
}

/** Turn starts: turn 0 starts at the first root event; turn k>0 at the k-th root prompt. */
function turnStartsOf(rootEvents: EngineEvent[]): Date[] {
  const first = rootEvents[0]
  if (!first) return []
  const prompts = rootEvents.filter(e => e.type === 'USER_PROMPT_SUBMIT')
  return [first.at, ...prompts.slice(1).map(p => p.at)]
}

function turnAt(turnStarts: Date[], at: Date): number {
  let turn = 0
  for (let i = 1; i < turnStarts.length; i++) {
    if (turnStarts[i]!.getTime() <= at.getTime()) turn = i
    else break
  }
  return turn
}

function timed(
  events: EngineEvent[],
  seqOf: Map<EngineEvent, number>
): TimedSignal[] {
  const out: TimedSignal[] = []
  for (const e of events) {
    for (const signal of e.signals) {
      out.push({ signal, at: e.at, seq: seqOf.get(e) ?? 0 })
    }
  }
  return out
}

interface RootSegmentDraft {
  taskId: string
  fromTurn: number
  toTurn: number
  borrowed: Borrowed[]
}

/** Root signals per turn, assigned by prompt count so equal-timestamp prompts still split. */
function signalsPerTurn(
  rootEvents: EngineEvent[],
  turnCount: number,
  seqOf: Map<EngineEvent, number>
): TimedSignal[][] {
  const perTurn: TimedSignal[][] = Array.from({ length: turnCount }, () => [])
  let promptIdx = -1
  for (const e of rootEvents) {
    if (e.type === 'USER_PROMPT_SUBMIT') promptIdx++
    const turn = Math.max(promptIdx, 0)
    for (const signal of e.signals) {
      if (signal.kind === 'AGENT_PROMPT') continue
      perTurn[turn]!.push({ signal, at: e.at, seq: seqOf.get(e) ?? 0 })
    }
  }
  return perTurn
}

/** The child session a turn-opening root prompt notifies about, per turn (R2). */
function notifiedChildPerTurn(
  rootEvents: EngineEvent[],
  turnCount: number,
  children: EngineSession[]
): (EngineSession | null)[] {
  const byAgent = new Map<string, EngineSession>()
  for (const c of children) if (c.agentId) byAgent.set(c.agentId, c)
  const out: (EngineSession | null)[] = Array.from(
    { length: turnCount },
    () => null
  )
  let promptIdx = -1
  for (const e of rootEvents) {
    if (e.type !== 'USER_PROMPT_SUBMIT') continue
    promptIdx++
    const child = e.notifiedAgentId ? byAgent.get(e.notifiedAgentId) : null
    if (child) out[promptIdx] = child
  }
  return out
}

function draftsOf(decisions: TurnDecision[]): RootSegmentDraft[] {
  const drafts: RootSegmentDraft[] = []
  let current: RootSegmentDraft | null = null
  // Leading signal-less turns fold into the first segment, never across an
  // unattributed turn (and no back-attribution at all after one).
  let leadingFrom: number | null = 0
  decisions.forEach((d, turn) => {
    if (d.kind === 'unattributed') {
      current = null
      leadingFrom = null
      return
    }
    if (!current) {
      if (d.kind !== 'task') return
      current = {
        taskId: d.taskId,
        fromTurn: leadingFrom ?? turn,
        toTurn: turn,
        borrowed: d.borrowed ? [d.borrowed] : [],
      }
      drafts.push(current)
      leadingFrom = null
      return
    }
    if (d.kind === 'task' && d.taskId !== current.taskId && d.switchCapable) {
      current = {
        taskId: d.taskId,
        fromTurn: turn,
        toTurn: turn,
        borrowed: d.borrowed ? [d.borrowed] : [],
      }
      drafts.push(current)
      return
    }
    current.toTurn = turn
    if (d.kind === 'task' && d.taskId === current.taskId && d.borrowed)
      current.borrowed.push(d.borrowed)
  })
  return drafts
}

function evidenceKey(e: EvidenceEntry): string {
  return `${e.kind}|${e.identifier}|${e.at}`
}

function segmentRoot(
  rootId: string,
  decisions: TurnDecision[],
  perTurn: TimedSignal[][],
  turnStarts: Date[]
): InferredSegment[] {
  const turnCount = turnStarts.length
  return draftsOf(decisions).map(d => {
    const fromAt = turnStarts[d.fromTurn]!
    const toAt = d.toTurn + 1 < turnCount ? turnStarts[d.toTurn + 1]! : null
    const hits: TimedSignal[] = []
    for (let turn = d.fromTurn; turn <= d.toTurn; turn++) {
      for (const s of perTurn[turn]!)
        if (s.signal.taskId === d.taskId) hits.push(s)
    }
    // A notification turn is explained by its subagent's evidence (R2).
    const evidence = toEvidence(hits)
    const seen = new Set(evidence.map(evidenceKey))
    for (const b of d.borrowed) {
      for (const e of b.evidence) {
        if (seen.has(evidenceKey(e))) continue
        seen.add(evidenceKey(e))
        evidence.push({ ...e })
      }
    }
    const confidence =
      confidenceOf(hits) === 'HIGH' ||
      d.borrowed.some(b => b.confidence === 'HIGH')
        ? 'HIGH'
        : 'MEDIUM'
    return {
      sessionId: rootId,
      taskId: d.taskId,
      fromTurn: d.fromTurn,
      toTurn: d.toTurn,
      fromAt,
      toAt,
      confidence,
      evidence: evidence.slice(0, MAX_EVIDENCE),
    }
  })
}

function withinWindow(
  at: string,
  fromAt: Date,
  toAt: Date | null,
  limit: Date = fromAt
): boolean {
  const ms = new Date(at).getTime()
  return (
    ms >= fromAt.getTime() &&
    (toAt === null || ms <= toAt.getTime()) &&
    ms <= Math.max(limit.getTime(), fromAt.getTime())
  )
}

/**
 * Clip the root's segments to a child's [first, last] event window. A child
 * that lies entirely before the root's first event attaches to the first
 * root segment. Evidence is restricted to entries inside the clipped window;
 * the parent segment's confidence is kept.
 */
function clipToRoot(
  childId: string,
  first: Date,
  last: Date,
  rootSegments: InferredSegment[],
  turnStarts: Date[]
): InferredSegment[] {
  const out: InferredSegment[] = []
  const cf = first.getTime()
  const cl = last.getTime()
  const head = rootSegments[0]
  if (head && cl < head.fromAt.getTime()) {
    const toAt = head.toAt ? new Date(Math.min(head.toAt.getTime(), cl)) : null
    out.push({
      sessionId: childId,
      taskId: head.taskId,
      fromTurn: 0,
      toTurn: Math.min(turnAt(turnStarts, last), head.toTurn),
      fromAt: first,
      toAt,
      confidence: head.confidence,
      evidence: head.evidence
        .filter(e => withinWindow(e.at, first, toAt, last))
        .map(e => ({ ...e })),
    })
    return out
  }
  for (const seg of rootSegments) {
    const from = seg.fromAt.getTime()
    const to = seg.toAt?.getTime() ?? Infinity
    if (cl < from || cf >= to) continue
    const fromAt = new Date(Math.max(from, cf))
    const toAt = seg.toAt ? new Date(Math.min(to, cl)) : null
    const endAt = new Date(Math.min(cl, to))
    out.push({
      sessionId: childId,
      taskId: seg.taskId,
      fromTurn: Math.max(turnAt(turnStarts, fromAt), seg.fromTurn),
      toTurn: Math.min(turnAt(turnStarts, endAt), seg.toTurn),
      fromAt,
      toAt,
      confidence: seg.confidence,
      evidence: seg.evidence
        .filter(e => withinWindow(e.at, fromAt, toAt, last))
        .map(e => ({ ...e })),
    })
  }
  return out
}

function segmentChild(
  child: EngineSession,
  childEvents: EngineEvent[],
  rootEvents: EngineEvent[],
  rootSegments: InferredSegment[],
  turnStarts: Date[],
  seqOf: Map<EngineEvent, number>
): InferredSegment[] {
  const first = childEvents[0]
  const last = childEvents[childEvents.length - 1]
  if (!first || !last) return []

  const followed = clipToRoot(
    child.id,
    first.at,
    last.at,
    rootSegments,
    turnStarts
  )
  const own = timed(childEvents, seqOf).filter(s =>
    STRONG_KINDS.has(s.signal.kind)
  )
  const dispatch =
    child.agentId == null
      ? []
      : timed(rootEvents, seqOf).filter(
          s =>
            s.signal.kind === 'AGENT_PROMPT' &&
            s.signal.agentId === child.agentId
        )
  const pool = own.length > 0 ? own : dispatch
  const taskId = pickTask(pool)
  // A dispatch prompt naming a task the parent is already on is not a
  // separate attribution: the child follows the parent (spec 6.4).
  const dispatchMatchesParent =
    own.length === 0 && followed.some(s => s.taskId === taskId)
  if (taskId && !dispatchMatchesParent) {
    const hits = pool.filter(s => s.signal.taskId === taskId)
    return [
      {
        sessionId: child.id,
        taskId,
        fromTurn: turnAt(turnStarts, first.at),
        toTurn: turnAt(turnStarts, last.at),
        fromAt: first.at,
        toAt: null,
        confidence: own.length > 0 ? 'HIGH' : 'MEDIUM',
        evidence: toEvidence(hits),
      },
    ]
  }
  return followed
}

/**
 * R2: the decision of a notification turn — the notifying child's task as the
 * child is attributed against the root segments decided so far.
 */
function followChild(
  child: EngineSession,
  childEvents: EngineEvent[],
  rootEvents: EngineEvent[],
  rootSegments: InferredSegment[],
  turnStarts: Date[],
  seqOf: Map<EngineEvent, number>
): TurnDecision {
  if (child.taskId) {
    return {
      kind: 'task',
      taskId: child.taskId,
      switchCapable: true,
      borrowed: { evidence: [], confidence: 'HIGH' },
    }
  }
  const segs = segmentChild(
    child,
    childEvents,
    rootEvents,
    rootSegments,
    turnStarts,
    seqOf
  )
  const tasks = new Set(segs.map(s => s.taskId))
  if (tasks.size !== 1) return UNATTRIBUTED
  return {
    kind: 'task',
    taskId: segs[0]!.taskId,
    switchCapable: true,
    borrowed: {
      evidence: segs.flatMap(s => s.evidence.map(e => ({ ...e }))),
      confidence: segs.some(s => s.confidence === 'HIGH') ? 'HIGH' : 'MEDIUM',
    },
  }
}

export function attributeTurns(input: {
  rootSessionId: string
  sessions: EngineSession[]
  events: EngineEvent[]
}): InferredSegment[] {
  const { rootSessionId, sessions } = input
  const sorted = sortByTime(input.events)
  const seqOf = new Map<EngineEvent, number>(sorted.map((e, i) => [e, i]))
  const bySession = new Map<string, EngineEvent[]>()
  for (const e of sorted) {
    const list = bySession.get(e.sessionId)
    if (list) list.push(e)
    else bySession.set(e.sessionId, [e])
  }

  const rootEvents = bySession.get(rootSessionId) ?? []
  const turnStarts = turnStartsOf(rootEvents)
  const turnCount = turnStarts.length
  const children = sessions.filter(
    c => c.parentSessionId === rootSessionId && c.id !== rootSessionId
  )
  const perTurn = signalsPerTurn(rootEvents, turnCount, seqOf)
  const notified = notifiedChildPerTurn(rootEvents, turnCount, children)

  // A notification turn without strong signals of its own waits for its child.
  const pending = (turn: number): boolean =>
    notified[turn] != null &&
    !perTurn[turn]!.some(s => STRONG_KINDS.has(s.signal.kind))
  const decisions: TurnDecision[] = perTurn.map((signals, turn) =>
    pending(turn) ? NONE : labelTurn(signals, turn)
  )
  // In turn order: a child that follows the root only sees earlier decisions.
  for (let turn = 0; turn < turnCount; turn++) {
    if (!pending(turn)) continue
    const child = notified[turn]!
    decisions[turn] = followChild(
      child,
      bySession.get(child.id) ?? [],
      rootEvents,
      segmentRoot(rootSessionId, decisions.slice(0, turn), perTurn, turnStarts),
      turnStarts,
      seqOf
    )
  }
  const rootSegments = segmentRoot(
    rootSessionId,
    decisions,
    perTurn,
    turnStarts
  )

  const out: InferredSegment[] = [...rootSegments]
  for (const child of children) {
    const childEvents = bySession.get(child.id) ?? []
    out.push(
      ...segmentChild(
        child,
        childEvents,
        rootEvents,
        rootSegments,
        turnStarts,
        seqOf
      )
    )
  }
  return out
}
