import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY_LENGTH = 32
const IV_LENGTH = 16
const TAG_LENGTH = 16

/**
 * Generate a random encryption key
 */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(KEY_LENGTH).toString('hex')
}

/**
 * Encrypt data using AES-256-GCM
 */
export function encrypt(data: string, key: string): string {
  try {
    const keyBuffer = Buffer.from(key, 'hex')
    const iv = crypto.randomBytes(IV_LENGTH)
    const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv)
    cipher.setAAD(Buffer.from('lumo-oauth', 'utf8'))

    let encrypted = cipher.update(data, 'utf8', 'hex')
    encrypted += cipher.final('hex')

    const tag = cipher.getAuthTag()

    // Combine IV + tag + encrypted data
    return iv.toString('hex') + tag.toString('hex') + encrypted
  } catch (error) {
    throw new Error(
      `Encryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

/**
 * Decrypt data using AES-256-GCM
 */
export function decrypt(encryptedData: string, key: string): string {
  try {
    const keyBuffer = Buffer.from(key, 'hex')

    // Extract IV, tag, and encrypted data
    const iv = Buffer.from(encryptedData.slice(0, IV_LENGTH * 2), 'hex')
    const tag = Buffer.from(
      encryptedData.slice(IV_LENGTH * 2, (IV_LENGTH + TAG_LENGTH) * 2),
      'hex'
    )
    const encrypted = encryptedData.slice((IV_LENGTH + TAG_LENGTH) * 2)

    const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer, iv)
    decipher.setAAD(Buffer.from('lumo-oauth', 'utf8'))
    decipher.setAuthTag(tag)

    let decrypted = decipher.update(encrypted, 'hex', 'utf8')
    decrypted += decipher.final('utf8')

    return decrypted
  } catch (error) {
    throw new Error(
      `Decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

/**
 * Encrypt OAuth tokens with separate keys
 */
export function encryptOAuthToken(
  token: string,
  tokenType: 'access' | 'refresh'
): string {
  const key =
    tokenType === 'access'
      ? process.env.ACCESS_TOKEN_KEY!
      : process.env.REFRESH_TOKEN_KEY!

  if (!key) {
    throw new Error(`${tokenType} token encryption key not configured`)
  }

  return encrypt(token, key)
}

/**
 * Decrypt OAuth tokens
 */
export function decryptOAuthToken(
  encryptedToken: string,
  tokenType: 'access' | 'refresh'
): string {
  const key =
    tokenType === 'access'
      ? process.env.ACCESS_TOKEN_KEY!
      : process.env.REFRESH_TOKEN_KEY!

  if (!key) {
    throw new Error(`${tokenType} token decryption key not configured`)
  }

  return decrypt(encryptedToken, key)
}
