/**
 * LUM-863 — pure AES-256-GCM primitives for application-layer envelope
 * encryption (server-only). No I/O and no env reads: the keyring
 * (`workspace-keyring.ts`) owns key material and caching.
 *
 * Two layers:
 *  - a key-encryption key (KEK, from the WORKSPACE_KEKS env ring) wraps each
 *    workspace's random data key (DEK);
 *  - the DEK seals the data itself into a self-describing envelope
 *    `lenc:v1:<dataKeyId>:<base64url(iv | ciphertext | tag)>`.
 * Both bind an AAD string, so a blob cannot be replayed under another
 * workspace / purpose without failing authentication.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALG = 'aes-256-gcm'
const IV_BYTES = 12
const TAG_BYTES = 16
export const KEY_BYTES = 32

export const ENVELOPE_PREFIX = 'lenc'
export const ENVELOPE_VERSION = 'v1'

/** One KEK of the ring. The first entry of a ring wraps new data keys. */
export interface Kek {
  id: string
  key: Buffer
}

export interface Envelope {
  version: string
  dataKeyId: string
  /** iv | ciphertext | tag */
  body: Buffer
}

const KEK_ID_RE = /^[A-Za-z0-9_-]{1,32}$/
const HEX_KEY_RE = /^[0-9a-fA-F]{64}$/

/**
 * Parse `"<kekId>:<64 hex>[,<kekId>:<64 hex>…]"`. Empty / unset → `[]`
 * (encryption disabled). Malformed → throws, so a typo fails loudly instead of
 * silently disabling encryption.
 */
export function parseKekRing(raw: string | undefined): Kek[] {
  if (!raw || raw.trim() === '') return []
  const ring: Kek[] = []
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim()
    const sep = trimmed.indexOf(':')
    const id = sep > 0 ? trimmed.slice(0, sep) : ''
    const hex = sep > 0 ? trimmed.slice(sep + 1) : ''
    if (!KEK_ID_RE.test(id) || !HEX_KEY_RE.test(hex)) {
      throw new Error(
        'WORKSPACE_KEKS must be "<kekId>:<64 hex chars>" entries separated by commas ' +
          '(generate a key with: openssl rand -hex 32)'
      )
    }
    if (ring.some(k => k.id === id)) {
      throw new Error(`WORKSPACE_KEKS lists KEK id "${id}" twice`)
    }
    ring.push({ id, key: Buffer.from(hex, 'hex') })
  }
  return ring
}

function seal(key: Buffer, plaintext: Buffer, aad: string): Buffer {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALG, key, iv)
  cipher.setAAD(Buffer.from(aad, 'utf8'))
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return Buffer.concat([iv, ct, cipher.getAuthTag()])
}

function open(key: Buffer, body: Buffer, aad: string): Buffer {
  if (body.length < IV_BYTES + TAG_BYTES) {
    throw new Error('Malformed ciphertext')
  }
  const iv = body.subarray(0, IV_BYTES)
  const tag = body.subarray(body.length - TAG_BYTES)
  const ct = body.subarray(IV_BYTES, body.length - TAG_BYTES)
  const decipher = createDecipheriv(ALG, key, iv)
  decipher.setAAD(Buffer.from(aad, 'utf8'))
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()])
}

/** AAD binding a wrapped data key to its workspace and its own id. */
export function dataKeyAad(workspaceId: string, dataKeyId: string): string {
  return `lumo:dek:${workspaceId}:${dataKeyId}`
}

/** A fresh random 256-bit data key. */
export function generateDataKey(): Buffer {
  return randomBytes(KEY_BYTES)
}

/** Wrap a data key under a KEK → base64 for storage. */
export function wrapDataKey(kek: Kek, dataKey: Buffer, aad: string): string {
  return seal(kek.key, dataKey, aad).toString('base64')
}

/** Unwrap a stored data key; throws when the KEK or AAD does not match. */
export function unwrapDataKey(kek: Kek, wrapped: string, aad: string): Buffer {
  const key = open(kek.key, Buffer.from(wrapped, 'base64'), aad)
  if (key.length !== KEY_BYTES) throw new Error('Unwrapped key has bad length')
  return key
}

/** Seal UTF-8 text under a data key into a versioned envelope string. */
export function sealString(
  dataKeyId: string,
  dataKey: Buffer,
  plaintext: string,
  aad: string
): string {
  const body = seal(dataKey, Buffer.from(plaintext, 'utf8'), aad)
  return `${ENVELOPE_PREFIX}:${ENVELOPE_VERSION}:${dataKeyId}:${body.toString('base64url')}`
}

/** Parse an envelope string; null when it is not one this module wrote. */
export function parseEnvelope(stored: string): Envelope | null {
  const parts = stored.split(':')
  if (parts.length !== 4) return null
  const [prefix, version, dataKeyId, body] = parts as [
    string,
    string,
    string,
    string,
  ]
  if (prefix !== ENVELOPE_PREFIX || version !== ENVELOPE_VERSION) return null
  if (!dataKeyId || !body) return null
  return { version, dataKeyId, body: Buffer.from(body, 'base64url') }
}

/** Open an envelope's body with its data key; throws on tamper / wrong key. */
export function openEnvelope(
  envelope: Envelope,
  dataKey: Buffer,
  aad: string
): string {
  return open(dataKey, envelope.body, aad).toString('utf8')
}
