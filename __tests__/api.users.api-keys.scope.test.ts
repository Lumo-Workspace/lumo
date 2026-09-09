/** @jest-environment node */
jest.mock('@/lib/auth', () => ({
  requireAuth: jest.fn().mockResolvedValue({ userId: 'c1' }),
  getUserWorkspace: jest.fn().mockResolvedValue({ member: { id: 'm1' } }),
}))
jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: { createApiKey: jest.fn(), findActiveApiKeys: jest.fn() },
}))
import { POST } from '@/app/api/users/api-keys/route'
import { miscRepository } from '@/lib/repositories/misc.repository'

const create = miscRepository.createApiKey as jest.Mock
const req = (body: unknown) =>
  ({ json: async () => body }) as unknown as Request

beforeEach(() => {
  jest.clearAllMocks()
  create.mockResolvedValue({
    id: 'k1',
    label: 'CI ingest',
    keyPrefix: 'lum_x',
    createdAt: new Date(),
    scope: 'security:ingest',
  })
})

test('creates a scoped key when scope=security:ingest', async () => {
  const res = await POST(req({ label: 'CI ingest', scope: 'security:ingest' }))
  expect(res.status).toBe(201)
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({ label: 'CI ingest', scope: 'security:ingest' })
  )
})

test('rejects an unknown scope with 400 and defaults to a full key when omitted', async () => {
  expect((await POST(req({ label: 'x', scope: 'admin' }))).status).toBe(400)
  await POST(req({ label: 'x' }))
  expect(create).toHaveBeenLastCalledWith(
    expect.objectContaining({ scope: null })
  )
})
