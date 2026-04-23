/**
 * @jest-environment node
 */
jest.mock('@/lib/services/auth.service', () => ({
  authService: { verifyApiKey: jest.fn() },
}))

import { authService } from '@/lib/services/auth.service'
import { verifyBearer } from '@/lib/auth/bearer'

const mockVerify = authService.verifyApiKey as jest.Mock

beforeEach(() => jest.clearAllMocks())

function req(header?: string): Request {
  const h = new Headers()
  if (header !== undefined) h.set('Authorization', header)
  return new Request('http://x/', { headers: h })
}

describe('verifyBearer', () => {
  it('returns null when Authorization header is missing', async () => {
    expect(await verifyBearer(req())).toBeNull()
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('returns null when header does not start with Bearer', async () => {
    expect(await verifyBearer(req('Basic abc'))).toBeNull()
  })

  it('returns null when token is empty', async () => {
    expect(await verifyBearer(req('Bearer   '))).toBeNull()
  })

  it('returns null when authService rejects the key', async () => {
    mockVerify.mockResolvedValue(null)
    expect(await verifyBearer(req('Bearer lum_bad'))).toBeNull()
  })

  it('returns identity when token is valid', async () => {
    const identity = { user: {}, workspace: {}, apiKey: {} }
    mockVerify.mockResolvedValue(identity)
    expect(await verifyBearer(req('Bearer lum_good'))).toBe(identity)
    expect(mockVerify).toHaveBeenCalledWith('lum_good')
  })
})
