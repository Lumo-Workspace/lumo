import { STRONG_KINDS, type SignalKind } from './signals'

/**
 * LUM-932 P2: pure per-turn attribution engine (spec sections 6.3 / 6.4).
 * Splits a root session into turns (one per root USER_PROMPT_SUBMIT), labels
 * each turn from the root's own signals, folds turns into task segments, and
 * attributes subagent child sessions. No I/O; inputs are never mutated.
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
}

export interface EngineSession {
  id: string
  parentSessionId: string | null
  agentId: string | null
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

interface TurnLabel {
  taskId: string
  switchCapable: boolean
}

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

function labelTurn(signals: TimedSignal[], turn: number): TurnLabel | null {
  const strong = pickTask(signals.filter(s => STRONG_KINDS.has(s.signal.kind)))
  if (strong) return { taskId: strong, switchCapable: true }
  const prompt = pickTask(signals.filter(s => s.signal.kind === 'PROMPT'))
  if (prompt) return { taskId: prompt, switchCapable: true }
  if (turn === 0) {
    const hint = pickTask(signals.filter(s => s.signal.kind === 'GIT_HINT'))
    if (hint) return { taskId: hint, switchCapable: false }
  }
  return null
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
}

function segmentRoot(
  rootId: string,
  rootEvents: EngineEvent[],
  turnStarts: Date[],
  seqOf: Map<EngineEvent, number>
): InferredSegment[] {
  const turnCount = turnStarts.length
  const perTurn: TimedSignal[][] = Array.from({ length: turnCount }, () => [])
  // Turn assignment by prompt count, so equal-timestamp prompts still split.
  let promptIdx = -1
  for (const e of rootEvents) {
    if (e.type === 'USER_PROMPT_SUBMIT') promptIdx++
    const turn = Math.max(promptIdx, 0)
    for (const signal of e.signals) {
      if (signal.kind === 'AGENT_PROMPT') continue
      perTurn[turn]!.push({ signal, at: e.at, seq: seqOf.get(e) ?? 0 })
    }
  }

  const drafts: RootSegmentDraft[] = []
  for (let turn = 0; turn < turnCount; turn++) {
    const label = labelTurn(perTurn[turn]!, turn)
    const current = drafts[drafts.length - 1]
    if (!current) {
      // Leading label-less turns are folded into the first segment.
      if (label)
        drafts.push({ taskId: label.taskId, fromTurn: 0, toTurn: turn })
      continue
    }
    if (label && label.taskId !== current.taskId && label.switchCapable) {
      drafts.push({ taskId: label.taskId, fromTurn: turn, toTurn: turn })
    } else {
      current.toTurn = turn
    }
  }

  return drafts.map((d, i) => {
    const fromAt = turnStarts[d.fromTurn]!
    const toAt = i < drafts.length - 1 ? turnStarts[d.toTurn + 1]! : null
    const hits: TimedSignal[] = []
    for (let turn = d.fromTurn; turn <= d.toTurn; turn++) {
      for (const s of perTurn[turn]!)
        if (s.signal.taskId === d.taskId) hits.push(s)
    }
    return {
      sessionId: rootId,
      taskId: d.taskId,
      fromTurn: d.fromTurn,
      toTurn: d.toTurn,
      fromAt,
      toAt,
      confidence: confidenceOf(hits),
      evidence: toEvidence(hits),
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
  const rootSegments = segmentRoot(rootSessionId, rootEvents, turnStarts, seqOf)

  const out: InferredSegment[] = [...rootSegments]
  for (const child of sessions) {
    if (child.parentSessionId !== rootSessionId || child.id === rootSessionId)
      continue
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
