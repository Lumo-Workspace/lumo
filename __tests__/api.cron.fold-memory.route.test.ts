/**
 * @jest-environment node
 *
 * LUM-553 — daily fold cron: CRON_SECRET gate + per-project best-effort.
 */
import { GET } from '@/app/api/cron/fold-memory/route'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { foldService } from '@/lib/services/memory/fold.service'

jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: { findProjectIdsWithActiveProjectMemory: jest.fn() },
}))
jest.mock('@/lib/services/memory/fold.service', () => ({
  foldService: { triggerForProject: jest.fn() },
}))

const mList =
  memoryRepository.findProjectIdsWithActiveProjectMemory as jest.Mock
const mTrigger = foldService.triggerForProject as jest.Mock

const reqWith = (auth: string | null) =>
  ({
    headers: { get: (k: string) => (k === 'authorization' ? auth : null) },
  }) as never

beforeEach(() => {
  jest.clearAllMocks()
  process.env.CRON_SECRET = 'secret-123'
  mList.mockResolvedValue(['p1', 'p2', 'p3'])
  mTrigger.mockResolvedValue({ folded: 1 })
})

describe('fold-memory cron requires CRON_SECRET and is per-project best-effort', () => {
  it('rejects a request without the cron secret with 401', async () => {
    const res = await GET(reqWith(null))
    expect(res.status).toBe(401)
    expect(mTrigger).not.toHaveBeenCalled()
  })

  it('runs triggerForProject for every project; one failure does not abort the rest', async () => {
    mTrigger
      .mockResolvedValueOnce({ folded: 1 })
      .mockRejectedValueOnce(new Error('boom')) // p2 throws
      .mockResolvedValueOnce({ folded: 0 })

    const res = await GET(reqWith('Bearer secret-123'))
    expect(res.status).toBe(200)
    expect(mTrigger).toHaveBeenCalledTimes(3)
    const body = await res.json()
    expect(body.projects).toBe(3)
  })
})
