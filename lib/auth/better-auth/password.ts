/**
 * LUM-1070 — password verification for Better Auth that also accepts the
 * bcrypt hashes imported from Clerk (RFC LUM-1069 §2).
 *
 * Clerk's user export carries bcrypt digests (`$2a$` / `$2b$` / `$2y$`). They
 * are checked with bcryptjs; every other hash is Better Auth's own scrypt
 * format and goes through its default verifier. Hashing is NOT overridden:
 * new and changed passwords are always stored as scrypt, so bcrypt hashes
 * fade out as people reset or change their password. A successful bcrypt
 * sign-in does not rehash (Better Auth has no hook for it, and the gain is
 * small).
 */
import { compare as bcryptCompare } from 'bcryptjs'
import { verifyPassword as verifyScryptPassword } from 'better-auth/crypto'

const BCRYPT_PREFIXES = ['$2a$', '$2b$', '$2y$'] as const

/** Pure: whether `hash` is a bcrypt digest (the format Clerk exports). */
export function isBcryptHash(hash: string): boolean {
  return BCRYPT_PREFIXES.some(prefix => hash.startsWith(prefix))
}

/**
 * `emailAndPassword.password.verify` — bcrypt for imported Clerk hashes,
 * Better Auth's default scrypt check for everything else.
 */
export async function verifyPasswordHash({
  hash,
  password,
}: {
  hash: string
  password: string
}): Promise<boolean> {
  if (isBcryptHash(hash)) return bcryptCompare(password, hash)
  return verifyScryptPassword({ hash, password })
}
