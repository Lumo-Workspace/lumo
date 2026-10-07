#!/usr/bin/env node

/**
 * Environment Setup Script
 * Generates proper environment variables for the Google OAuth Login feature
 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

function generateEncryptionKey() {
  return crypto.randomBytes(32).toString('hex')
}

function generateNextAuthSecret() {
  return crypto.randomBytes(32).toString('base64')
}

function main() {
  console.log('🔧 Setting up environment variables for Google OAuth Login...\n')

  const envPath = path.join(process.cwd(), '.env.local')
  const envExamplePath = path.join(process.cwd(), '.env.example')

  // Check if .env.local already exists
  if (fs.existsSync(envPath)) {
    console.log(
      '⚠️  .env.local already exists. Backing up to .env.local.backup'
    )
    fs.copyFileSync(envPath, envPath + '.backup')
  }

  // Read .env.example as template
  let envContent = ''
  if (fs.existsSync(envExamplePath)) {
    envContent = fs.readFileSync(envExamplePath, 'utf8')
  } else {
    // Fallback template
    envContent = `# Database
SUPA_POSTGRES_PRISMA_URL="postgresql://username:password@localhost:5432/lumo_dev"
SUPA_POSTGRES_URL_NON_POOLING="postgresql://username:password@localhost:5432/lumo_dev"

# NextAuth.js
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-secret-key-here"

# Google OAuth
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"

# Encryption (for OAuth tokens)
OAUTH_ENCRYPTION_KEY="your-32-character-encryption-key"
ACCESS_TOKEN_KEY="your-access-token-encryption-key"
REFRESH_TOKEN_KEY="your-refresh-token-encryption-key"

# Vercel Blob Storage
BLOB_READ_WRITE_TOKEN="your-vercel-blob-token"
`
  }

  // Generate new values
  const newValues = {
    NEXTAUTH_SECRET: generateNextAuthSecret(),
    OAUTH_ENCRYPTION_KEY: generateEncryptionKey(),
    ACCESS_TOKEN_KEY: generateEncryptionKey(),
    REFRESH_TOKEN_KEY: generateEncryptionKey(),
  }

  // Replace placeholder values
  let updatedContent = envContent
  Object.entries(newValues).forEach(([key, value]) => {
    const regex = new RegExp(`${key}="[^"]*"`, 'g')
    updatedContent = updatedContent.replace(regex, `${key}="${value}"`)
  })

  // Write .env.local
  fs.writeFileSync(envPath, updatedContent)

  console.log('✅ Generated .env.local with proper encryption keys and secrets')
  console.log('\n🔑 Generated values:')
  Object.entries(newValues).forEach(([key, value]) => {
    console.log(`   ${key}="${value}"`)
  })

  console.log('\n📝 Next steps:')
  console.log(
    '1. Update GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET with your Google OAuth credentials'
  )
  console.log(
    '2. Update SUPA_POSTGRES_PRISMA_URL with your PostgreSQL connection string'
  )
  console.log('3. Update NEXTAUTH_URL to match your deployment URL')
  console.log(
    '4. Update BLOB_READ_WRITE_TOKEN with your Vercel Blob storage token'
  )
  console.log('\n📖 See SETUP.md for detailed instructions')

  // Check for Prisma dev server connection string
  console.log(
    '\n💡 Tip: If you\'re using Prisma dev server, update SUPA_POSTGRES_PRISMA_URL with the connection string from "npx prisma dev"'
  )
}

if (require.main === module) {
  main()
}

module.exports = { generateEncryptionKey, generateNextAuthSecret }
