/**
 * @jest-environment node
 *
 * LUM-1070 — bcrypt-compatible password verification for Better Auth.
 */
import { randomBytes } from 'node:crypto'
import { hash as bcryptHash } from 'bcryptjs'
import { hashPassword } from 'better-auth/crypto'
import {
  isBcryptHash,
  verifyPasswordHash,
} from '@/lib/auth/better-auth/password'

const password = `pw-${randomBytes(9).toString('base64url')}`

describe('isBcryptHash (LUM-1070)', () => {
  it.each(['$2a$10$abc', '$2b$12$abc', '$2y$10$abc'])('%s is bcrypt', h => {
    expect(isBcryptHash(h)).toBe(true)
  })

  it.each(['', 'salt:key', '$2x$10$abc', '$argon2id$v=19$', '2a$10$'])(
    '%p is not bcrypt',
    h => {
      expect(isBcryptHash(h)).toBe(false)
    }
  )
})

describe('verifyPasswordHash (LUM-1070)', () => {
  it.each(['$2a$', '$2b$', '$2y$'])(
    'verifies a %s digest with bcrypt',
    async prefix => {
      const digest = prefix + (await bcryptHash(password, 4)).slice(4)
      await expect(
        verifyPasswordHash({ hash: digest, password })
      ).resolves.toBe(true)
      await expect(
        verifyPasswordHash({ hash: digest, password: `${password}x` })
      ).resolves.toBe(false)
    }
  )

  it("verifies Better Auth's own scrypt hashes with the default verifier", async () => {
    const scrypt = await hashPassword(password)
    expect(isBcryptHash(scrypt)).toBe(false)
    await expect(verifyPasswordHash({ hash: scrypt, password })).resolves.toBe(
      true
    )
    await expect(
      verifyPasswordHash({ hash: scrypt, password: `${password}x` })
    ).resolves.toBe(false)
  })
})
