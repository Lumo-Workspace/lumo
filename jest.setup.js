import '@testing-library/jest-dom'

// jsdom doesn't expose TextEncoder/TextDecoder, but Node has them natively
// and several production deps (notably `pg`'s crypto module) reference them
// at import time. Polyfill onto the global so tests can require these deps
// under the jsdom testEnvironment without a ReferenceError.
import { TextEncoder, TextDecoder } from 'util'
if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = TextEncoder
}
if (typeof global.TextDecoder === 'undefined') {
  global.TextDecoder = TextDecoder
}

// Mock Next.js router
jest.mock('next/navigation', () => ({
  useRouter() {
    return {
      push: jest.fn(),
      replace: jest.fn(),
      prefetch: jest.fn(),
      back: jest.fn(),
      forward: jest.fn(),
      refresh: jest.fn(),
    }
  },
  useSearchParams() {
    return new URLSearchParams()
  },
  usePathname() {
    return '/'
  },
}))

// Mock Next.js image component
jest.mock('next/image', () => ({
  __esModule: true,
  default: props => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...props} />
  },
}))

// Mock environment variables
process.env.NEXTAUTH_URL = 'http://localhost:3000'
process.env.NEXTAUTH_SECRET = 'test-secret'
process.env.GOOGLE_CLIENT_ID = 'test-client-id'
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret'
process.env.SUPA_POSTGRES_PRISMA_URL =
  'postgresql://test:test@localhost:5432/test'
process.env.ACCESS_TOKEN_KEY = 'test-access-token-key-32-chars'
process.env.REFRESH_TOKEN_KEY = 'test-refresh-token-key-32-chars'

// Mock Prisma Client — spread actual module so runtime enum objects (e.g.
// DocMentionSource, DocVisibility, TaskStatus …) are available in tests
// that import them directly from '@prisma/client'.
jest.mock('@prisma/client', () => ({
  ...jest.requireActual('@prisma/client'),
  PrismaClient: jest.fn().mockImplementation(() => ({
    // LUM-918: lib/db/prisma wraps the client in a query extension.
    $extends: jest.fn(function () {
      return this
    }),
    user: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    userProfile: {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    account: {
      create: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    session: {
      create: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    verificationToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
  })),
}))
