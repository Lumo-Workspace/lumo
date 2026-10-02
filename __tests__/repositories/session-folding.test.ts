/** @jest-environment node */
/**
 * LUM-932 P3 acceptance #6: counts use top-level sessions only. Drives the
 * real repository code against a small in-memory Prisma double that evaluates
 * the `where` clauses the session/retrospective queries use (an unknown key
 * throws, so a query the double cannot honor fails loudly instead of passing).
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findUnique: jest.fn() },
    session: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
    },
    hookEvent: { findMany: jest.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { retrospectiveRepository } from '@/lib/repositories/retrospective.repository'

interface FakeSession {
  id: string
  taskId: string | null
  parentSessionId: string | null
  bindingSource: 'ATTACH' | 'INHERITED' | null
  workspaceMemberId: string
  startedAt: Date
  lastActivityAt: Date
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheCreationTokens: number | null
  loopCount: number | null
  runSummary: string | null
  /** Has a STOP with a turnSummary (run-summary generation material). */
  hasStopDigest: boolean
  role: 'IMPLEMENTATION' | 'STEWARD'
  milestoneId: string | null
}

interface FakeSegment {
  sessionId: string
  taskId: string
  source: 'INFERRED' | 'EXPLICIT'
}

interface FakeUsageEvent {
  taskId: string
  sessionId: string
  workspaceMemberId: string
  type: 'STOP'
  usageByModel: Record<string, unknown>
}

const TASK_STATUS: Record<string, string> = { t1: 'DONE' }
let sessions: FakeSession[] = []
let segments: FakeSegment[] = []
let usageEvents: FakeUsageEvent[] = []

const at = (minute: number) => new Date(Date.UTC(2026, 8, 1, 0, minute, 0))

function session(
  id: string,
  over: Partial<FakeSession> & { minute: number; tokens: number }
): FakeSession {
  const { minute, tokens, ...rest } = over
  return {
    id,
    taskId: 't1',
    parentSessionId: null,
    bindingSource: 'ATTACH',
    workspaceMemberId: 'm1',
    startedAt: at(minute),
    lastActivityAt: at(minute),
    inputTokens: tokens,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    loopCount: 1,
    runSummary: null,
    hasStopDigest: true,
    role: 'IMPLEMENTATION',
    milestoneId: null,
    ...rest,
  }
}

function matchScalar(value: unknown, cond: unknown): boolean {
  if (cond === null) return value === null
  if (typeof cond !== 'object') return value === cond
  const c = cond as Record<string, unknown>
  if ('in' in c) return (c.in as unknown[]).includes(value)
  if ('not' in c) return c.not === null ? value !== null : value !== c.not
  throw new Error(`unsupported scalar condition ${JSON.stringify(cond)}`)
}

function matchSegment(g: FakeSegment, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (k === 'taskId' || k === 'source')
      return matchScalar(g[k as 'taskId' | 'source'], cond)
    if (k === 'session') {
      const s = sessions.find(x => x.id === g.sessionId)!
      return matchSession(s, cond as Record<string, unknown>)
    }
    throw new Error(`unsupported segment key ${k}`)
  })
}

function matchSession(s: FakeSession, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, cond]) => {
    switch (k) {
      case 'id':
      case 'taskId':
      case 'parentSessionId':
      case 'runSummary':
      case 'outputTokens':
      case 'role':
      case 'milestoneId':
        return matchScalar(s[k], cond)
      case 'NOT':
        return !matchSession(s, cond as Record<string, unknown>)
      case 'attributionSegments': {
        const some = (cond as { some: Record<string, unknown> }).some
        return segments.some(g => g.sessionId === s.id && matchSegment(g, some))
      }
      case 'task': {
        const status = (cond as { status: { in: string[] } }).status
        return s.taskId !== null && status.in.includes(TASK_STATUS[s.taskId]!)
      }
      case 'events':
        // Only used as "has a STOP/STOP_FAILURE with a turnSummary".
        return s.hasStopDigest
      default:
        throw new Error(`unsupported session key ${k}`)
    }
  })
}

type FindArgs = {
  where?: Record<string, unknown>
  orderBy?: unknown
  take?: number
  distinct?: string[]
}

function findSessions(args: FindArgs): FakeSession[] {
  let rows = sessions.filter(s => matchSession(s, args.where ?? {}))
  const orders = Array.isArray(args.orderBy)
    ? args.orderBy
    : args.orderBy
      ? [args.orderBy]
      : []
  rows = [...rows].sort((a, b) => {
    for (const o of orders as Array<Record<string, 'asc' | 'desc'>>) {
      const [key, dir] = Object.entries(o)[0]!
      const av = a[key as keyof FakeSession] as Date | string
      const bv = b[key as keyof FakeSession] as Date | string
      const d =
        av instanceof Date
          ? av.getTime() - (bv as Date).getTime()
          : String(av).localeCompare(String(bv))
      if (d !== 0) return dir === 'asc' ? d : -d
    }
    return 0
  })
  if (args.distinct) {
    const seen = new Set<unknown>()
    rows = rows.filter(r => {
      const key = args.distinct!.map(k => r[k as keyof FakeSession]).join('|')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }
  return args.take !== undefined ? rows.slice(0, args.take) : rows
}

/** Is this the inferred-usage query (vs. the active-time turn stream)? */
function isInferredUsageQuery(where: Record<string, unknown>): boolean {
  const s = where.session as { taskId?: unknown } | undefined
  return !!s && s.taskId === null && 'usageByModel' in where
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(prisma.session.findMany as jest.Mock).mockImplementation(
    async (args: FindArgs) => findSessions(args)
  )
  ;(prisma.session.findFirst as jest.Mock).mockImplementation(
    async (args: FindArgs) => findSessions({ ...args, take: 1 })[0] ?? null
  )
  ;(prisma.session.count as jest.Mock).mockImplementation(
    async (args: FindArgs) => findSessions(args).length
  )
  ;(prisma.task.findUnique as jest.Mock).mockImplementation(
    async (args: { where: { id: string } }) => ({
      projectId: 'p1',
      sessions: sessions.filter(s => s.taskId === args.where.id),
    })
  )
  ;(prisma.hookEvent.findMany as jest.Mock).mockImplementation(
    async (args: { where: Record<string, unknown> }) => {
      if (!isInferredUsageQuery(args.where)) return []
      const ids = (args.where.taskId as { in: string[] }).in
      return usageEvents
        .filter(e => ids.includes(e.taskId))
        .map(e => {
          const s = sessions.find(x => x.id === e.sessionId)!
          return {
            ...e,
            session: {
              parentSessionId: s.parentSessionId,
              startedAt: s.startedAt,
              parent: null,
            },
          }
        })
    }
  )

  // Two explicit top-level sessions bound to t1 (P, Q), 15 subagent children
  // of P that inherited the binding and are NEWER than every top-level row (so
  // a children-blind newest-first list would fill its limit with them), and
  // one unattached top-level session U the engine inferred onto t1.
  const P = session('P', { minute: 2, tokens: 100 })
  const Q = session('Q', { minute: 1, tokens: 50 })
  const children = Array.from({ length: 15 }, (_, i) =>
    session(`P:c${i + 1}`, {
      minute: 10 + i,
      tokens: 10,
      parentSessionId: 'P',
      bindingSource: 'INHERITED',
      loopCount: null,
    })
  )
  const U = session('U', {
    minute: 3,
    tokens: 999, // cumulative, spans other tasks — never this task's cost
    taskId: null,
    bindingSource: null,
    workspaceMemberId: 'm2',
  })
  sessions = [P, Q, ...children, U]
  segments = [{ sessionId: 'U', taskId: 't1', source: 'INFERRED' }]
  usageEvents = [
    {
      taskId: 't1',
      sessionId: 'U',
      workspaceMemberId: 'm2',
      type: 'STOP',
      usageByModel: {
        opus: { input: 7, output: 0, cacheRead: 0, cacheCreation: 0 },
      },
    },
  ]
})

describe('counts top-level sessions and folds child sessions', () => {
  it('15 child sessions do not push a top-level session out of listForTask', async () => {
    const rows = await sessionRepository.listForTask('t1', 3)
    expect(rows.map(r => r.id)).toEqual(['U', 'P', 'Q'])
    expect(rows.map(r => r.inferred)).toEqual([true, false, false])
  })

  it('an unattached top-level session with an INFERRED segment is listed under the default limit too', async () => {
    const rows = await sessionRepository.listForTask('t1')
    expect(rows.map(r => r.id)).toEqual(['U', 'P', 'Q'])
  })

  it('cost trajectory has one point per top-level session and sums to the task cost total', async () => {
    const [points, actuals] = await Promise.all([
      retrospectiveRepository.loadPerSessionCost('t1'),
      retrospectiveRepository.loadActuals('t1'),
    ])
    expect(points.map(p => p.sessionId).sort()).toEqual(['P', 'Q', 'U'])
    // P folds its 15 children (100 + 15×10); U is its per-turn usage only.
    const byId = new Map(points.map(p => [p.sessionId, p.tokenCost]))
    expect(byId.get('P')).toBe(250)
    expect(byId.get('Q')).toBe(50)
    expect(byId.get('U')).toBe(7)
    const sum = points.reduce((n, p) => n + p.tokenCost, 0)
    expect(sum).toBe(actuals!.tokenCost)
    expect(sum).toBe(307)
  })

  it('iterations count explicit top-level + inferred unattached sessions, never children', async () => {
    const actuals = await retrospectiveRepository.loadActuals('t1')
    expect(actuals!.iterations).toBe(3)
  })

  it('child sessions never appear as missing a run summary or in the session-id list', async () => {
    expect(await sessionRepository.listForTaskMissingRunSummary('t1')).toEqual([
      'P',
      'Q',
    ])
    expect(await sessionRepository.listSessionIdsForTask('t1')).toEqual([
      'P',
      'Q',
    ])
    // Once every top-level session is summarized, summary-less children do
    // not keep the task on the backfill list.
    for (const s of sessions)
      if (s.parentSessionId === null) s.runSummary = 'done'
    expect(await sessionRepository.listForTaskMissingRunSummary('t1')).toEqual(
      []
    )
    expect(
      await sessionRepository.listCompletedTaskIdsMissingRunSummary()
    ).toEqual([])
  })

  it('the latest run claim comes from a top-level session, not a newer child', async () => {
    const claim = await sessionRepository.loadLatestRunClaim('t1')
    expect(claim?.id).toBe('P')
  })

  it('a STEWARD session with a stale INFERRED segment is neither listed nor counted (I2)', async () => {
    sessions.push(
      session('S', {
        minute: 4,
        tokens: 5,
        taskId: null,
        bindingSource: null,
        role: 'STEWARD',
        milestoneId: 'ms1',
      })
    )
    segments.push({ sessionId: 'S', taskId: 't1', source: 'INFERRED' })
    const rows = await sessionRepository.listForTask('t1')
    expect(rows.map(r => r.id)).toEqual(['U', 'P', 'Q'])
    const actuals = await retrospectiveRepository.loadActuals('t1')
    expect(actuals!.iterations).toBe(3)
  })
})
