/**
 * @jest-environment node
 */

// Set ENCRYPTION_KEY before any module imports that reference lib/crypto
process.env.ENCRYPTION_KEY = 'a'.repeat(64) // 64 hex chars = 32 bytes, valid for AES-256-GCM

import {
  encodeOauthState,
  decodeOauthState,
} from '@/lib/services/figma-integration.service'

describe('Figma OAuth state', () => {
  it('round-trips workspaceId, memberId, workspaceUrl', () => {
    const state = encodeOauthState({
      workspaceId: 'w1',
      memberId: 'm1',
      workspaceUrl: 'lumo',
    })
    expect(state).not.toContain('w1') // encrypted, not plaintext
    expect(decodeOauthState(state)).toEqual({
      workspaceId: 'w1',
      memberId: 'm1',
      workspaceUrl: 'lumo',
    })
  })

  it('returns null on tampered ciphertext', () => {
    const state = encodeOauthState({
      workspaceId: 'w1',
      memberId: 'm1',
      workspaceUrl: 'lumo',
    })
    const tampered = state.slice(0, -2) + 'xx'
    expect(decodeOauthState(tampered)).toBeNull()
  })

  it('returns null on garbage input', () => {
    expect(decodeOauthState('not-a-state')).toBeNull()
  })
})

import { completeOauthFlow } from '@/lib/services/figma-integration.service'
import { figmaIntegrationRepository } from '@/lib/repositories/figma-integration.repository'

jest.mock('@/lib/repositories/figma-integration.repository', () => ({
  figmaIntegrationRepository: {
    upsert: jest.fn(),
    findByMember: jest.fn(),
    delete: jest.fn(),
  },
}))

jest.mock('@/lib/integrations/figma/oauth', () => ({
  exchangeCode: jest.fn(),
}))

import { exchangeCode } from '@/lib/integrations/figma/oauth'

describe('completeOauthFlow', () => {
  beforeEach(() => jest.resetAllMocks())

  it('exchanges code, fetches user, upserts encrypted integration', async () => {
    ;(exchangeCode as jest.Mock).mockResolvedValue({
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: 3600,
      user_id: 'u1',
    })
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'u1',
        email: 'a@b.com',
        handle: 'alice',
        img_url: '',
      }),
    }) as unknown as typeof fetch

    await completeOauthFlow({
      workspaceId: 'w1',
      memberId: 'm1',
      code: 'the-code',
    })

    expect(figmaIntegrationRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'w1',
        memberId: 'm1',
        figmaUserId: 'u1',
        figmaHandle: 'alice',
        figmaEmail: 'a@b.com',
      })
    )
    const arg = (figmaIntegrationRepository.upsert as jest.Mock).mock
      .calls[0][0]
    // encrypted tokens, not raw
    expect(arg.accessToken).not.toBe('at')
    expect(arg.refreshToken).not.toBe('rt')
  })
})
