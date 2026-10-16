/**
 * @jest-environment node
 */

/**
 * LUM-801: test case 的 CRUD + run 路由。
 *
 * 路由是薄的（auth → zod → service → response），所以这里只锁路由自己的职责：
 * 404 的两个来源、Zod 拒绝时不会调到 service、以及 X-Lumo-Session-Id 有被穿到
 * attribution 里（run 的出处取证靠它）。
 */
import { NextRequest } from 'next/server'

jest.mock('@/lib/auth', () => ({
  requireIdentity: jest.fn().mockResolvedValue({
    clerkId: 'u-1',
    memberId: 'm-1',
    workspaceId: 'w-1',
    workspaceSlug: 'acme',
    workspaceName: 'Acme',
    source: 'bearer',
  }),
}))

const resolveTaskParam = jest.fn()
jest.mock('@/lib/api/resolve-task-param', () => ({
  resolveTaskParam: (...a: unknown[]) => resolveTaskParam(...a),
}))

const resolveTestCaseParam = jest.fn()
jest.mock('@/lib/api/resolve-test-case-param', () => ({
  resolveTestCaseParam: (...a: unknown[]) => resolveTestCaseParam(...a),
}))

const listForTask = jest.fn()
const create = jest.fn()
const recordRun = jest.fn()
const remove = jest.fn()
jest.mock('@/lib/services/task-test-case.service', () => ({
  taskTestCaseService: {
    listForTask: (...a: unknown[]) => listForTask(...a),
    create: (...a: unknown[]) => create(...a),
    recordRun: (...a: unknown[]) => recordRun(...a),
    remove: (...a: unknown[]) => remove(...a),
    getDetail: jest.fn(),
    update: jest.fn(),
  },
}))

import { GET, POST } from '@/app/api/tasks/[id]/test-cases/route'
import { POST as RUN_POST } from '@/app/api/tasks/[id]/test-cases/[caseRef]/runs/route'
import { DELETE } from '@/app/api/tasks/[id]/test-cases/[caseRef]/route'

const params = (over: Record<string, string> = {}) => ({
  params: Promise.resolve({ id: 'LUM-1', caseRef: 'TC1', ...over }),
})

const post = (
  url: string,
  body: unknown,
  headers: Record<string, string> = {}
) =>
  new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  })

const aCase = {
  id: 'tc-1',
  taskId: 't-1',
  number: 1,
  steps: ['a'],
  verification: [],
}

beforeEach(() => {
  jest.clearAllMocks()
  resolveTaskParam.mockResolvedValue({ id: 't-1', status: 'IN_PROGRESS' })
  resolveTestCaseParam.mockResolvedValue(aCase)
})

describe('GET /api/tasks/[id]/test-cases', () => {
  it('returns the task test cases', async () => {
    listForTask.mockResolvedValue({ testCases: [], pullRequests: [] })
    const res = await GET(
      new NextRequest('http://x/api/tasks/LUM-1/test-cases'),
      params()
    )
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      testCases: [],
      pullRequests: [],
    })
  })

  it('404s an unknown task', async () => {
    resolveTaskParam.mockResolvedValue(null)
    const res = await GET(
      new NextRequest('http://x/api/tasks/LUM-9/test-cases'),
      params({ id: 'LUM-9' })
    )
    expect(res.status).toBe(404)
  })
})

describe('POST /api/tasks/[id]/test-cases', () => {
  it('400s a body with no steps', async () => {
    const res = await POST(
      post('http://x/api/tasks/LUM-1/test-cases', {
        title: 'x',
        steps: [],
        verification: [],
        expected: 'y',
      }),
      params()
    )
    expect(res.status).toBe(400)
    expect(create).not.toHaveBeenCalled()
  })

  it('creates on a valid body', async () => {
    create.mockResolvedValue({ testCase: { id: 'tc-1' } })
    const res = await POST(
      post('http://x/api/tasks/LUM-1/test-cases', {
        title: 'x',
        steps: ['a'],
        verification: [],
        expected: 'y',
      }),
      params()
    )
    expect(res.status).toBe(200)
    expect(create).toHaveBeenCalled()
  })
})

describe('POST /api/tasks/[id]/test-cases/[caseRef]/runs', () => {
  it('404s an unknown case ref', async () => {
    resolveTestCaseParam.mockResolvedValue(null)
    const res = await RUN_POST(
      post('http://x/api/tasks/LUM-1/test-cases/TC9/runs', {
        result: 'PASS',
        environment: 'LOCAL',
      }),
      params({ caseRef: 'TC9' })
    )
    expect(res.status).toBe(404)
  })

  it('400s a run body with no environment', async () => {
    const res = await RUN_POST(
      post('http://x/api/tasks/LUM-1/test-cases/TC1/runs', { result: 'PASS' }),
      params()
    )
    expect(res.status).toBe(400)
    expect(recordRun).not.toHaveBeenCalled()
  })

  it('threads X-Lumo-Session-Id into the attribution', async () => {
    recordRun.mockResolvedValue({ run: { id: 'run-1' } })
    await RUN_POST(
      post(
        'http://x/api/tasks/LUM-1/test-cases/TC1/runs',
        { result: 'PASS', environment: 'LOCAL' },
        { 'X-Lumo-Session-Id': 'sess-9' }
      ),
      params()
    )
    expect(recordRun).toHaveBeenCalledWith(
      aCase,
      expect.objectContaining({ environment: 'LOCAL' }),
      expect.objectContaining({
        actorMemberId: 'm-1',
        sourceSessionId: 'sess-9',
      })
    )
  })

  it.each(['no-evidence', 'skipped'] as const)(
    'adds unobserved: [] to a %s ceiling for old CLIs',
    async reason => {
      recordRun.mockResolvedValue({
        run: { id: 'run-1' },
        ceiling: { effective: 'UNPROVEN', reason },
      })
      const res = await RUN_POST(
        post('http://x/api/tasks/LUM-1/test-cases/TC1/runs', {
          result: 'PASS',
          environment: 'LOCAL',
        }),
        params()
      )
      const body = await res.json()
      expect(body.ceiling).toEqual({
        effective: 'UNPROVEN',
        reason,
        unobserved: [],
      })
    }
  )

  it('maps a service 400 onto the response status', async () => {
    recordRun.mockRejectedValue(
      Object.assign(new Error('not linked to this task'), { status: 400 })
    )
    const res = await RUN_POST(
      post('http://x/api/tasks/LUM-1/test-cases/TC1/runs', {
        result: 'PASS',
        environment: 'LOCAL',
        pullRequestNumber: 999,
      }),
      params()
    )
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      error: 'not linked to this task',
    })
  })

  it('does not leak an internal error message on a 500', async () => {
    recordRun.mockRejectedValue(new Error('connection string leaked here'))
    const res = await RUN_POST(
      post('http://x/api/tasks/LUM-1/test-cases/TC1/runs', {
        result: 'PASS',
        environment: 'LOCAL',
      }),
      params()
    )
    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({ error: 'Internal error' })
  })
})

describe('DELETE /api/tasks/[id]/test-cases/[caseRef]', () => {
  it('soft-deletes via the service', async () => {
    remove.mockResolvedValue(undefined)
    const res = await DELETE(
      new NextRequest('http://x/api/tasks/LUM-1/test-cases/TC1', {
        method: 'DELETE',
      }),
      params()
    )
    expect(res.status).toBe(200)
    expect(remove).toHaveBeenCalledWith('tc-1', expect.anything())
  })
})
