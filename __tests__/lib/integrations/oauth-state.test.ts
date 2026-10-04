/**
 * @jest-environment node
 */
import { encrypt } from '@/lib/crypto'
import {
  OAUTH_STATE_TTL_MS,
  decodeOauthState,
  encodeOauthState,
} from '@/lib/integrations/oauth-state'

beforeAll(() => {
  if (!process.env.ENCRYPTION_KEY) process.env.ENCRYPTION_KEY = '0'.repeat(64)
})

const payload = { workspaceId: 'w1', memberId: 'm1', workspaceUrl: 'lumo' }
const NOW = 1_800_000_000_000

describe('oauth-state', () => {
  it('round-trips a fresh state', () => {
    const state = encodeOauthState(payload, NOW)
    expect(decodeOauthState(state, NOW + 1000)).toEqual({ ok: true, payload })
  })

  it('accepts a state right at the TTL boundary', () => {
    const state = encodeOauthState(payload, NOW)
    expect(decodeOauthState(state, NOW + OAUTH_STATE_TTL_MS).ok).toBe(true)
  })

  it('rejects a state older than the TTL as expired', () => {
    const state = encodeOauthState(payload, NOW)
    expect(decodeOauthState(state, NOW + OAUTH_STATE_TTL_MS + 1)).toEqual({
      ok: false,
      reason: 'expired',
    })
  })

  it('rejects a state without iat (minted before expiry existed) as expired', () => {
    const legacy = encrypt(JSON.stringify(payload))
    expect(decodeOauthState(legacy, NOW)).toEqual({
      ok: false,
      reason: 'expired',
    })
  })

  it('rejects an iat far in the future as invalid', () => {
    const state = encodeOauthState(payload, NOW + 5 * 60 * 1000)
    expect(decodeOauthState(state, NOW)).toEqual({
      ok: false,
      reason: 'invalid',
    })
  })

  it('rejects a tampered state as invalid', () => {
    const state = encodeOauthState(payload, NOW)
    const [iv, tag, ct] = state.split(':') as [string, string, string]
    const flipped = (ct[0] === 'a' ? 'b' : 'a') + ct.slice(1)
    expect(decodeOauthState(`${iv}:${tag}:${flipped}`, NOW)).toEqual({
      ok: false,
      reason: 'invalid',
    })
    expect(decodeOauthState('garbage', NOW).ok).toBe(false)
  })

  it('rejects a well-encrypted but malformed payload as invalid', () => {
    const bad = encrypt(JSON.stringify({ memberId: 'm1', iat: NOW }))
    expect(decodeOauthState(bad, NOW)).toEqual({
      ok: false,
      reason: 'invalid',
    })
  })
})
