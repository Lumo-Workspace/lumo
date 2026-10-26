/**
 * AES-256-GCM encrypt / decrypt helpers (server-only).
 *
 * Stored format: "<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 *
 * Requires env var:
 *   ENCRYPTION_KEY — 64-character hex string (32 bytes).
 *   Generate with:  openssl rand -hex 32
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALG = 'aes-256-gcm'

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY
  if (!hex || hex.length !== 64) {
    throw new Error(
      'ENCRYPTION_KEY must be set to a 64-character hex string (32 bytes). ' +
        'Generate one with: openssl rand -hex 32'
    )
  }
  return Buffer.from(hex, 'hex')
}

/** Whether ENCRYPTION_KEY is set to a usable key (encrypt/decrypt would not throw on it). */
export function isEncryptionKeyConfigured(): boolean {
  const hex = process.env.ENCRYPTION_KEY
  return !!hex && /^[0-9a-fA-F]{64}$/.test(hex)
}

export function encrypt(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(12) // 96-bit IV — GCM standard
  const cipher = createCipheriv(ALG, key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag() // 128-bit auth tag
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`
}

export function decrypt(stored: string): string {
  const key = getKey()
  const parts = stored.split(':')
  if (parts.length !== 3) throw new Error('Malformed encrypted value')
  const ivHex = parts[0]!
  const authTagHex = parts[1]!
  const ciphertextHex = parts[2]!
  const decipher = createDecipheriv(ALG, key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, 'hex')),
    decipher.final(),
  ])
  return plaintext.toString('utf8')
}
