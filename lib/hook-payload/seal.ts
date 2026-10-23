/**
 * LUM-1302 — the at-rest form of an encrypted HookEvent payload. Pure: the
 * caller supplies the workspace data key (lib/hook-payload/data-key-ring.ts).
 *
 * A sealed payload is stored in the same `payload` Json column as
 *   { "_enc": "v1:<keyId>:<iv>:<tag>:<ciphertext>" }   (base64url parts)
 * AES-256-GCM over the payload's JSON text. The key id is bound as
 * additional authenticated data, so a ciphertext cannot be relabelled with
 * another key id.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

export const SEALED_PAYLOAD_KEY = '_enc'
const FORMAT = 'v1'
const ALG = 'aes-256-gcm'

export interface DataKey {
  id: string
  /** 32 raw bytes. */
  key: Buffer
}

export interface SealedPayload {
  [SEALED_PAYLOAD_KEY]: string
}

function aad(keyId: string): Buffer {
  return Buffer.from(`lumo-hook-payload:${FORMAT}:${keyId}`, 'utf8')
}

/** True for the stored shape: an object whose only key is a v1 `_enc` string. */
export function isSealedPayload(value: unknown): value is SealedPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false
  const keys = Object.keys(value)
  if (keys.length !== 1 || keys[0] !== SEALED_PAYLOAD_KEY) return false
  const sealed = (value as Record<string, unknown>)[SEALED_PAYLOAD_KEY]
  return typeof sealed === 'string' && sealed.startsWith(`${FORMAT}:`)
}

/** The id of the key a sealed payload was encrypted with. */
export function sealedKeyId(sealed: SealedPayload): string {
  const keyId = sealed[SEALED_PAYLOAD_KEY].split(':')[1]
  if (!keyId) throw new Error('Malformed sealed payload')
  return keyId
}

/** Encrypt a JSON value with a workspace data key. */
export function sealPayload(value: unknown, dataKey: DataKey): SealedPayload {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALG, dataKey.key, iv)
  cipher.setAAD(aad(dataKey.id))
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  return {
    [SEALED_PAYLOAD_KEY]: [
      FORMAT,
      dataKey.id,
      iv.toString('base64url'),
      tag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join(':'),
  }
}

/** Decrypt a sealed payload. Throws on a wrong key or a tampered value. */
export function openPayload(sealed: SealedPayload, dataKey: DataKey): unknown {
  const parts = sealed[SEALED_PAYLOAD_KEY].split(':')
  if (parts.length !== 5 || parts[0] !== FORMAT)
    throw new Error('Malformed sealed payload')
  const [, keyId, iv, tag, ciphertext] = parts as [
    string,
    string,
    string,
    string,
    string,
  ]
  if (keyId !== dataKey.id)
    throw new Error(`Sealed payload names key ${keyId}, got ${dataKey.id}`)
  const decipher = createDecipheriv(
    ALG,
    dataKey.key,
    Buffer.from(iv, 'base64url')
  )
  decipher.setAAD(aad(keyId))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ])
  return JSON.parse(plaintext.toString('utf8'))
}
