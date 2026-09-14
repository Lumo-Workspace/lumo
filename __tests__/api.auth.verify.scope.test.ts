/**
 * @jest-environment node
 *
 * LUM-735 — GET /api/auth/verify is the CLI's "am I logged in" endpoint. The
 * CI ingest key (`scope: 'security:ingest'`) lives in a repo secret and may
 * ONLY push SARIF reports: if this route accepted it, anyone who could read
 * that secret would have a working CLI login to the whole workspace.
 */
jest.mock('@/lib/services/auth.service', () => ({
  authService: { verifyApiKey: jest.fn(), fetchUserProfile: jest.fn() },
  SECURITY_INGEST_SCOPE: 'security:ingest',
}))

import { GET } from '@/app/api/auth/verify/route'
import { authService } from '@/lib/services/auth.service'

const verifyApiKey = authService.verifyApiKey as jest.Mock
const fetchUserProfile = authService.fetchUserProfile as jest.Mock

const identity = (scope: string | null) => ({
  user: { id: 'u1' },
  workspace: { id: 'w1', slug: 'acme', name: 'Acme' },
  apiKey: { id: 'k1', name: 'ci', prefix: 'lumo_', scope },
})

const makeReq = (auth: string | null) =>
  ({
    headers: { get: (k: string) => (k === 'Authorization' ? auth : null) },
  }) as unknown as Request

beforeEach(() => {
  jest.clearAllMocks()
  fetchUserProfile.mockResolvedValue({ email: 'a@b.c', name: 'A' })
})

describe('GET /api/auth/verify', () => {
  it('refuses a security:ingest scoped key with 401 and never hits Clerk', async () => {
    verifyApiKey.mockResolvedValue(identity('security:ingest'))
    const res = await GET(makeReq('Bearer lum_scoped'))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({
      error: 'This key is scoped to CI ingest and cannot be used to log in',
    })
    expect(fetchUserProfile).not.toHaveBeenCalled()
  })

  it('accepts an unscoped (full) key', async () => {
    verifyApiKey.mockResolvedValue(identity(null))
    const res = await GET(makeReq('Bearer lum_full'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      user: { id: 'u1', email: 'a@b.c', name: 'A' },
      workspace: { id: 'w1', slug: 'acme' },
    })
  })

  it('refuses an unknown key and a missing bearer with 401', async () => {
    verifyApiKey.mockResolvedValue(null)
    expect((await GET(makeReq('Bearer nope'))).status).toBe(401)
    expect((await GET(makeReq(null))).status).toBe(401)
    expect(verifyApiKey).toHaveBeenCalledTimes(1)
  })
})
