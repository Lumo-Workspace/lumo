/**
 * @jest-environment node
 *
 * LUM-1188 — the agent-runs / progress / agent-runs report read routes accept
 * an API key (requireIdentity) and resolve the task inside the caller's
 * workspace. The real `resolveTaskParam` runs; only the repository is faked,
 * honouring the workspace filter the real query applies — so a task of
 * another workspace is a 404 whether addressed by cuid or by identifier.
 */
import { NextRequest, NextResponse } from 'next/server'

const requireIdentity = jest.fn()
jest.mock('@/lib/auth', () => ({
  requireIdentity: (...a: unknown[]) => requireIdentity(...a),
}))

const TASK_CUID = 'c' + 'a'.repeat(24)
const TASK = { id: TASK_CUID, workspaceId: 'ws-alpha', team: 'LUM', number: 7 }
jest.mock('@/lib/repositories', () => ({
  taskRepository: {
    findByIdForMention: jest.fn(async (id: string, workspaceId: string) =>
      id === TASK.id && workspaceId === TASK.workspaceId
        ? { id: TASK.id, status: 'IN_PROGRESS', workStartedAt: null }
        : null
    ),
    findByWorkspaceIdentifier: jest.fn(
      async (workspaceId: string, team: string, number: number) =>
        workspaceId === TASK.workspaceId &&
        team === TASK.team &&
        number === TASK.number
          ? { id: TASK.id, status: 'IN_PROGRESS', workStartedAt: null }
          : null
    ),
  },
}))

const getTimeline = jest.fn()
jest.mock('@/lib/services/agent-run-timeline.service', () => ({
  agentRunTimelineService: {
    getTimeline: (...a: unknown[]) => getTimeline(...a),
  },
}))
const getProgress = jest.fn()
jest.mock('@/lib/services', () => ({
  progressService: { getProgress: (...a: unknown[]) => getProgress(...a) },
}))
const getReport = jest.fn()
jest.mock('@/lib/services/agent-run-report.service', () => ({
  agentRunReportService: { getReport: (...a: unknown[]) => getReport(...a) },
}))

import { GET as agentRunsGET } from '@/app/api/tasks/[id]/agent-runs/route'
import { GET as progressGET } from '@/app/api/tasks/[id]/progress/route'
import { GET as reportGET } from '@/app/api/tasks/[id]/agent-runs/report/route'

const identity = (
  workspaceId: string,
  source: 'bearer' | 'clerk' = 'bearer'
) => ({
  clerkId: 'u-1',
  memberId: 'm-1',
  workspaceId,
  workspaceSlug: workspaceId,
  workspaceName: workspaceId,
  source,
})

const ROUTES: Array<[string, typeof agentRunsGET, jest.Mock, unknown]> = [
  ['GET /api/tasks/[id]/agent-runs', agentRunsGET, getTimeline, { runs: [] }],
  [
    'GET /api/tasks/[id]/progress',
    progressGET,
    getProgress,
    { sessionCount: 0 },
  ],
  ['GET /api/tasks/[id]/agent-runs/report', reportGET, getReport, { runs: [] }],
]

const call = (handler: typeof agentRunsGET, id: string) =>
  // requireIdentity is stubbed: the identity it returns IS the credential.
  handler(new NextRequest(`http://x/api/tasks/${id}`), {
    params: Promise.resolve({ id }),
  })

beforeEach(() => {
  jest.clearAllMocks()
  getTimeline.mockResolvedValue({ runs: [] })
  getProgress.mockResolvedValue({ sessionCount: 0 })
  getReport.mockResolvedValue({ runs: [] })
})

describe.each(ROUTES)('%s', (_name, handler, service, payload) => {
  it.each([TASK_CUID, 'LUM-7', 'lum-7'])(
    'API key of the owning workspace reads task %s → 200',
    async id => {
      requireIdentity.mockResolvedValue(identity('ws-alpha'))
      const res = await call(handler, id)
      expect(res.status).toBe(200)
      expect(service).toHaveBeenCalledWith(TASK_CUID)
      const body = await res.json()
      expect(JSON.stringify(body)).toContain(JSON.stringify(payload))
    }
  )

  it.each([TASK_CUID, 'LUM-7'])(
    'API key of another workspace → 404 for task %s, service never called',
    async id => {
      requireIdentity.mockResolvedValue(identity('ws-bravo'))
      const res = await call(handler, id)
      expect(res.status).toBe(404)
      expect(service).not.toHaveBeenCalled()
    }
  )

  it('browser session scoped to another workspace → 404', async () => {
    requireIdentity.mockResolvedValue(identity('ws-bravo', 'clerk'))
    const res = await call(handler, TASK_CUID)
    expect(res.status).toBe(404)
    expect(service).not.toHaveBeenCalled()
  })

  it('passes an auth failure through untouched', async () => {
    requireIdentity.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const res = await call(handler, TASK_CUID)
    expect(res.status).toBe(401)
    expect(service).not.toHaveBeenCalled()
  })

  it('500s without leaking the error when the service throws', async () => {
    requireIdentity.mockResolvedValue(identity('ws-alpha'))
    service.mockRejectedValue(new Error('db exploded: secret detail'))
    const res = await call(handler, TASK_CUID)
    expect(res.status).toBe(500)
    expect(await res.text()).not.toContain('secret detail')
  })
})
