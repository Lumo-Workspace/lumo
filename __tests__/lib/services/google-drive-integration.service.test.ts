import {
  encodeOauthState,
  decodeOauthState,
} from '@/lib/services/google-drive-integration.service'

// lib/crypto needs an ENCRYPTION_KEY; jest setup already provides a test key in
// other crypto-dependent suites (figma). If not present, set one here.
beforeAll(() => {
  if (!process.env.ENCRYPTION_KEY) {
    process.env.ENCRYPTION_KEY = '0'.repeat(64)
  }
})

describe('google-drive oauth state', () => {
  it('round-trips a valid payload', () => {
    const token = encodeOauthState({
      workspaceId: 'ws1',
      memberId: 'm1',
      workspaceUrl: 'lumo',
    })
    expect(decodeOauthState(token)).toEqual({
      workspaceId: 'ws1',
      memberId: 'm1',
      workspaceUrl: 'lumo',
    })
  })

  it('rejects a garbage state', () => {
    expect(decodeOauthState('not-a-real-token')).toBeNull()
  })
})
