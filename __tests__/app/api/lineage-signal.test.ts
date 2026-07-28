/**
 * @jest-environment node
 */
const getUsageSignalHealth = jest.fn()
jest.mock('@/lib/services/lineage/usage-signal.service', () => ({
  usageSignalService: {
    getUsageSignalHealth: (ws: string) => getUsageSignalHealth(ws),
  },
}))
jest.mock('@/lib/auth/identity', () => ({
  requireIdentity: jest.fn(),
}))
import { requireIdentity } from '@/lib/auth/identity'
import { GET } from '@/app/api/lineage/signal/route'

it('returns the signal-health DTO for the caller workspace', async () => {
  ;(requireIdentity as jest.Mock).mockResolvedValue({
    workspaceId: 'ws1',
    memberId: 'm1',
  })
  getUsageSignalHealth.mockResolvedValue({
    distribution: { used: 1, unused: 0, abstained: 2 },
  })
  const res = await GET(new Request('http://x'))
  expect(getUsageSignalHealth).toHaveBeenCalledWith('ws1')
  expect((await res.json()).distribution.used).toBe(1)
})
