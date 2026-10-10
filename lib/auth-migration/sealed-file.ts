/**
 * LUM-1072 — encrypted files for the Clerk → Better Auth migration tooling
 * (scripts/auth-migration). Every file the tools read or write that holds
 * user data (the Clerk CSV, the export bundle, detail reports) is sealed with
 * AES-256-GCM under a key derived (scrypt) from a passphrase in the user's
 * shell environment. Plaintext only ever exists in memory.
 *
 * RFC LUM-1069 §8 names `age`; it is not installed here and adding a
 * dependency for it is not worth it, so this is the same idea (file-level
 * encryption, secret from the environment) with Node's built-in crypto.
 *
 * Every path must lie OUTSIDE any git work tree (RFC §8): a sealed export
 * accidentally committed is still a leak waiting for a weak passphrase.
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto'
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const PASSPHRASE_ENV = 'LUMO_MIGRATION_PASSPHRASE'
export const MIN_PASSPHRASE_LENGTH = 20

const MAGIC = Buffer.from('LUMOSEAL', 'ascii')
const VERSION = 1
const SALT_BYTES = 16
const IV_BYTES = 12
const TAG_BYTES = 16
const HEADER_BYTES = MAGIC.length + 1 + SALT_BYTES + IV_BYTES
// scrypt N=2^15, r=8 needs 32 MiB; allow headroom.
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

function migrationError(message: string): Error {
  return Object.assign(new Error(message), { status: 400 })
}

/** The passphrase from the environment; never echoed back. */
export function passphraseFromEnv(
  env: Record<string, string | undefined> = process.env
): string {
  const value = env[PASSPHRASE_ENV]
  if (!value) {
    throw migrationError(
      `${PASSPHRASE_ENV} is not set. Export it in your own shell (it is never printed).`
    )
  }
  if (value.length < MIN_PASSPHRASE_LENGTH) {
    throw migrationError(
      `${PASSPHRASE_ENV} must be at least ${MIN_PASSPHRASE_LENGTH} characters.`
    )
  }
  return value
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32, SCRYPT)
}

export function seal(plaintext: Buffer, passphrase: string): Buffer {
  const salt = randomBytes(SALT_BYTES)
  const iv = randomBytes(IV_BYTES)
  const header = Buffer.concat([MAGIC, Buffer.from([VERSION]), salt, iv])
  const cipher = createCipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv)
  cipher.setAAD(header)
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return Buffer.concat([header, body, cipher.getAuthTag()])
}

export function isSealed(data: Buffer): boolean {
  return (
    data.length >= HEADER_BYTES + TAG_BYTES &&
    data.subarray(0, MAGIC.length).equals(MAGIC)
  )
}

export function unseal(data: Buffer, passphrase: string): Buffer {
  if (!isSealed(data)) {
    throw migrationError(
      'Not a sealed file. Seal it first with scripts/auth-migration/seal.ts (plaintext inputs are refused).'
    )
  }
  if (data[MAGIC.length] !== VERSION) {
    throw migrationError('Unsupported sealed-file version.')
  }
  let offset = MAGIC.length + 1
  const salt = data.subarray(offset, (offset += SALT_BYTES))
  const iv = data.subarray(offset, (offset += IV_BYTES))
  const header = data.subarray(0, HEADER_BYTES)
  const body = data.subarray(HEADER_BYTES, data.length - TAG_BYTES)
  const tag = data.subarray(data.length - TAG_BYTES)
  const decipher = createDecipheriv(
    'aes-256-gcm',
    deriveKey(passphrase, salt),
    iv
  )
  decipher.setAAD(header)
  decipher.setAuthTag(tag)
  try {
    return Buffer.concat([decipher.update(body), decipher.final()])
  } catch {
    throw migrationError(
      'Could not decrypt: wrong passphrase or the file is damaged.'
    )
  }
}

/** The nearest existing ancestor of `p` (or `p` itself), symlinks resolved. */
function realExistingAncestor(p: string): string {
  let current = path.resolve(p)
  while (!existsSync(current)) {
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return realpathSync(current)
}

/** The git work tree containing `p`, or null. */
export function findGitWorkTree(p: string): string | null {
  let dir = realExistingAncestor(p)
  for (;;) {
    if (existsSync(path.join(dir, '.git'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** Refuse any data file inside a git work tree (RFC LUM-1069 §8). */
export function assertOutsideGitRepo(p: string, label: string): void {
  if (findGitWorkTree(p) !== null) {
    throw migrationError(
      `${label} is inside a git repository. Keep migration data outside every git work tree (e.g. ~/lumo-auth-migration, mode 700).`
    )
  }
}

export function readSealedFile(
  file: string,
  passphrase: string,
  label = 'input file'
): Buffer {
  assertOutsideGitRepo(file, label)
  if (!existsSync(file)) throw migrationError(`${label} does not exist.`)
  return unseal(readFileSync(file), passphrase)
}

/** Write a new sealed file (mode 600). Refuses to overwrite. */
export function writeSealedFile(
  file: string,
  plaintext: Buffer,
  passphrase: string,
  label = 'output file'
): void {
  assertOutsideGitRepo(file, label)
  if (existsSync(file)) {
    throw migrationError(`${label} already exists; choose a new path.`)
  }
  writeFileSync(file, seal(plaintext, passphrase), { mode: 0o600, flag: 'wx' })
}
