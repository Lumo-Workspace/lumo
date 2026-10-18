/**
 * @jest-environment node
 */
import { GET } from '@/app/api/cost/route'

jest.mock('@/lib/auth/identity', () => ({
  requireIdentity: jest
    .fn()
    .mockResolvedValue({ workspaceId: 'w1', memberId: 'm1' }),
}))
jest.mock('@/lib/services/operation-cost.service', () => ({
  operationCostService: { getOperationCost: jest.fn() },
}))

describe('GET /api/cost', () => {
  it('passes a task scope through and returns the payload', async () => {
    const { operationCostService } =
      await import('@/lib/services/operation-cost.service')
    ;(operationCostService.getOperationCost as jest.Mock).mockResolvedValue({
      version: 1,
    })
    const res = await GET(new Request('http://x/api/cost?task=LUM-1'))
    expect(res.status).toBe(200)
    expect(
      operationCostService.getOperationCost as jest.Mock
    ).toHaveBeenCalledWith('w1', { kind: 'task', identifier: 'LUM-1' })
  })

  it('passes a session scope through', async () => {
    const { operationCostService } =
      await import('@/lib/services/operation-cost.service')
    ;(operationCostService.getOperationCost as jest.Mock).mockResolvedValue({
      version: 1,
    })
    const res = await GET(new Request('http://x/api/cost?session=abc'))
    expect(res.status).toBe(200)
    expect(
      operationCostService.getOperationCost as jest.Mock
    ).toHaveBeenCalledWith('w1', { kind: 'session', sessionId: 'abc' })
  })

  it('defaults to a workspace scope with no params', async () => {
    const { operationCostService } =
      await import('@/lib/services/operation-cost.service')
    ;(operationCostService.getOperationCost as jest.Mock).mockResolvedValue({
      version: 1,
    })
    const res = await GET(new Request('http://x/api/cost'))
    expect(res.status).toBe(200)
    expect(
      operationCostService.getOperationCost as jest.Mock
    ).toHaveBeenCalledWith('w1', { kind: 'workspace' })
  })

  it('400s when both task and session are passed', async () => {
    const res = await GET(
      new Request('http://x/api/cost?task=LUM-1&session=abc')
    )
    expect(res.status).toBe(400)
  })

  it('404s when the task does not resolve', async () => {
    const { operationCostService } =
      await import('@/lib/services/operation-cost.service')
    ;(operationCostService.getOperationCost as jest.Mock).mockResolvedValue(
      null
    )
    const res = await GET(new Request('http://x/api/cost?task=NOPE-9'))
    expect(res.status).toBe(404)
  })

  it('LUM-1233 3e: passes an until bound for usage show --until', async () => {
    const { operationCostService } =
      await import('@/lib/services/operation-cost.service')
    ;(operationCostService.getOperationCost as jest.Mock).mockResolvedValue({
      version: 1,
    })
    const res = await GET(
      new Request(
        'http://x/api/cost?since=2026-10-01T00:00:00.000Z&until=2026-10-08T00:00:00.000Z'
      )
    )
    expect(res.status).toBe(200)
    expect(
      operationCostService.getOperationCost as jest.Mock
    ).toHaveBeenLastCalledWith('w1', {
      kind: 'workspace',
      since: new Date('2026-10-01T00:00:00.000Z'),
      until: new Date('2026-10-08T00:00:00.000Z'),
    })
    expect(
      (await GET(new Request('http://x/api/cost?until=nope'))).status
    ).toBe(400)
    expect(
      (
        await GET(
          new Request(
            'http://x/api/cost?since=2026-10-08T00:00:00.000Z&until=2026-10-01T00:00:00.000Z'
          )
        )
      ).status
    ).toBe(400)
  })
})
