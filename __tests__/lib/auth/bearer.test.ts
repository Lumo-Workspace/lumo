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
    expect(mockVerify).toHaveBeenCalledWith('lum_bad')
  })

  it('returns identity when token is valid', async () => {
    const identity = { user: {}, workspace: {}, apiKey: {} }
    mockVerify.mockResolvedValue(identity)
    expect(await verifyBearer(req('Bearer lum_good'))).toBe(identity)
    expect(mockVerify).toHaveBeenCalledWith('lum_good')
  })

  it('accepts a lowercase bearer scheme per RFC 7235', async () => {
    const identity = { user: {}, workspace: {}, apiKey: {} }
    mockVerify.mockResolvedValue(identity)
    expect(await verifyBearer(req('bearer lum_good'))).toBe(identity)
    expect(mockVerify).toHaveBeenCalledWith('lum_good')
  })

  it('propagates errors thrown by authService', async () => {
    mockVerify.mockRejectedValue(new Error('DB down'))
    await expect(verifyBearer(req('Bearer lum_x'))).rejects.toThrow('DB down')
  })
})

describe('LUM-735 scoped keys', () => {
  const scoped = {
    user: { id: 'u1' },
    workspace: { id: 'w1', slug: 's', name: 'n' },
    apiKey: {
      id: 'k1',
      name: 'CI ingest',
      prefix: 'lum_x',
      scope: 'security:ingest',
    },
  }
  const req = (auth: string) =>
    ({ headers: { get: () => auth } }) as unknown as Request

  it('rejects a scoped key by default', async () => {
    mockVerify.mockResolvedValue(scoped)
    expect(await verifyBearer(req('Bearer lum_x'))).toBeNull()
  })
  it('accepts a scoped key only for a route that allows that scope', async () => {
    mockVerify.mockResolvedValue(scoped)
    expect(
      await verifyBearer(req('Bearer lum_x'), {
        allowScopes: ['security:ingest'],
      })
    ).toEqual(scoped)
    expect(
      await verifyBearer(req('Bearer lum_x'), { allowScopes: ['other'] })
    ).toBeNull()
  })
  it('a full key (scope null/undefined) still passes everywhere', async () => {
    mockVerify.mockResolvedValue({
      ...scoped,
      apiKey: { ...scoped.apiKey, scope: null },
    })
    expect(await verifyBearer(req('Bearer lum_x'))).not.toBeNull()
    expect(
      await verifyBearer(req('Bearer lum_x'), {
        allowScopes: ['security:ingest'],
      })
    ).not.toBeNull()
  })
})
