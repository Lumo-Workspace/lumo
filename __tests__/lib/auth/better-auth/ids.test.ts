/**
 * @jest-environment node
 *
 * LUM-1070 — Better Auth record ids: users get Clerk's `user_` shape.
 */
import { USER_ID_PREFIX, generateAuthId } from '@/lib/auth/better-auth/ids'

describe('generateAuthId (LUM-1070)', () => {
  it('prefixes user ids with user_ and a 32-char random part', () => {
    const id = generateAuthId({ model: 'user' })
    expect(USER_ID_PREFIX).toBe('user_')
    expect(id).toMatch(/^user_[A-Za-z0-9]{32}$/)
  })

  it.each(['session', 'account', 'verification', 'rateLimit', 'oauthClient'])(
    'leaves %s ids unprefixed',
    model => {
      expect(generateAuthId({ model })).toMatch(/^[A-Za-z0-9]{32}$/)
    }
  )

  it('does not repeat', () => {
    const ids = new Set(
      Array.from({ length: 200 }, () => generateAuthId({ model: 'user' }))
    )
    expect(ids.size).toBe(200)
  })
})
