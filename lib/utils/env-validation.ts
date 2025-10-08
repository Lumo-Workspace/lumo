/**
 * Environment variable validation utility
 * Provides clear error messages for missing or invalid environment variables
 */

import { generateEncryptionKey } from './encryption'

export interface EnvValidationResult {
  isValid: boolean
  errors: string[]
  warnings: string[]
}

export function validateEnvironmentVariables(): EnvValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Required variables
  const requiredVars = [
    'DATABASE_URL',
    'NEXTAUTH_URL',
    'NEXTAUTH_SECRET',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
  ]

  // Check required variables
  for (const varName of requiredVars) {
    const value = process.env[varName]
    if (!value || value.trim() === '') {
      errors.push(`Missing required environment variable: ${varName}`)
    } else if (value.includes('your-') || value.includes('placeholder')) {
      // For Google OAuth credentials, only error in production runtime (not build time)
      const isBuildTime = process.env.NEXT_PHASE === 'phase-production-build'
      const isProduction = process.env.NODE_ENV === 'production' && !isBuildTime

      if (
        isProduction &&
        (varName === 'GOOGLE_CLIENT_ID' || varName === 'GOOGLE_CLIENT_SECRET')
      ) {
        errors.push(
          `Environment variable ${varName} contains placeholder value. Please set a real value.`
        )
      } else if (
        varName !== 'GOOGLE_CLIENT_ID' &&
        varName !== 'GOOGLE_CLIENT_SECRET'
      ) {
        errors.push(
          `Environment variable ${varName} contains placeholder value. Please set a real value.`
        )
      }
    }
  }

  // Validate encryption keys
  const encryptionKeys = [
    'OAUTH_ENCRYPTION_KEY',
    'ACCESS_TOKEN_KEY',
    'REFRESH_TOKEN_KEY',
  ]

  for (const keyName of encryptionKeys) {
    const key = process.env[keyName]
    if (!key || key.trim() === '') {
      errors.push(`Missing required encryption key: ${keyName}`)
    } else if (key.includes('your-') || key.includes('placeholder')) {
      errors.push(
        `Encryption key ${keyName} contains placeholder value. Please generate a real key.`
      )
    } else if (key.length !== 64) {
      errors.push(
        `Encryption key ${keyName} must be exactly 64 hex characters (32 bytes). Current length: ${key.length}`
      )
    } else if (!/^[0-9a-fA-F]+$/.test(key)) {
      errors.push(
        `Encryption key ${keyName} must contain only hexadecimal characters (0-9, a-f, A-F)`
      )
    }
  }

  // Validate NEXTAUTH_SECRET
  const nextAuthSecret = process.env.NEXTAUTH_SECRET
  if (nextAuthSecret && nextAuthSecret.length < 32) {
    warnings.push(
      `NEXTAUTH_SECRET should be at least 32 characters for security. Current length: ${nextAuthSecret.length}`
    )
  }

  // Check for development vs production settings
  // During build time, be more lenient with validation
  const isBuildTime = process.env.NEXT_PHASE === 'phase-production-build'
  const isProduction = process.env.NODE_ENV === 'production' && !isBuildTime

  if (isProduction) {
    if (process.env.NEXTAUTH_URL?.includes('localhost')) {
      errors.push('NEXTAUTH_URL cannot use localhost in production')
    }
    if (!process.env.NEXTAUTH_URL?.startsWith('https://')) {
      errors.push('NEXTAUTH_URL must use HTTPS in production')
    }
  } else {
    // In development or build time, allow placeholder values but warn
    if (
      process.env.GOOGLE_CLIENT_ID?.includes('your-') ||
      process.env.GOOGLE_CLIENT_ID?.includes('placeholder')
    ) {
      warnings.push(
        'GOOGLE_CLIENT_ID contains placeholder value - OAuth will not work until set'
      )
    }
    if (
      process.env.GOOGLE_CLIENT_SECRET?.includes('your-') ||
      process.env.GOOGLE_CLIENT_SECRET?.includes('placeholder')
    ) {
      warnings.push(
        'GOOGLE_CLIENT_SECRET contains placeholder value - OAuth will not work until set'
      )
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  }
}

export function generateMissingKeys(): Record<string, string> {
  const keys: Record<string, string> = {}

  const encryptionKeys = [
    'OAUTH_ENCRYPTION_KEY',
    'ACCESS_TOKEN_KEY',
    'REFRESH_TOKEN_KEY',
  ]

  for (const keyName of encryptionKeys) {
    const key = process.env[keyName]
    if (!key || key.includes('your-') || key.includes('placeholder')) {
      keys[keyName] = generateEncryptionKey()
    }
  }

  // Generate NEXTAUTH_SECRET if missing
  if (
    !process.env.NEXTAUTH_SECRET ||
    process.env.NEXTAUTH_SECRET.includes('your-')
  ) {
    const crypto = require('crypto')
    keys.NEXTAUTH_SECRET = crypto.randomBytes(32).toString('base64')
  }

  return keys
}

export function printEnvironmentSetup(): void {
  const validation = validateEnvironmentVariables()

  if (validation.isValid) {
    console.log('✅ Environment configuration is valid')
    if (validation.warnings.length > 0) {
      console.log('\n⚠️  Warnings:')
      validation.warnings.forEach(warning => console.log(`   - ${warning}`))
    }
  } else {
    console.log('❌ Environment configuration has errors:')
    validation.errors.forEach(error => console.log(`   - ${error}`))

    const missingKeys = generateMissingKeys()
    if (Object.keys(missingKeys).length > 0) {
      console.log('\n🔑 Generate these keys:')
      console.log('Add these to your .env.local file:')
      Object.entries(missingKeys).forEach(([key, value]) => {
        console.log(`${key}="${value}"`)
      })
    }

    console.log('\n📖 See SETUP.md for detailed setup instructions')
  }
}
