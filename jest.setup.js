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

// jsdom has no ResizeObserver; Radix popper (Tooltip/Popover) measures via
// @radix-ui/react-use-size, which constructs one on mount. No-op stub.
if (typeof global.ResizeObserver === 'undefined') {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
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

// LUM-1338: every AI feature asks aiFeaturesService (server) or
// useAiFeatures (client) before it calls a model or shows an AI entry point.
// Tests of those features run with every switch on — the test env has no
// model configured, which would otherwise switch them all off. Tests of the
// switches themselves `jest.unmock` these modules.
jest.mock('@/lib/services/ai-features.service', () => {
  const actual = jest.requireActual('@/lib/services/ai-features.service')
  return {
    ...actual,
    aiFeaturesService: {
      ...actual.aiFeaturesService,
      isEnabled: jest.fn(async () => true),
      isAiConfigured: jest.fn(() => true),
      workspaceIdsWithFeatureOff: jest.fn(async () => []),
      assertEnabled: jest.fn(async () => undefined),
    },
  }
})
jest.mock('@/hooks/use-ai-features', () => {
  const actual = jest.requireActual('@/hooks/use-ai-features')
  return {
    ...actual,
    useAiFeatures: () => ({
      status: null,
      isLoading: false,
      error: null,
      isOn: () => true,
    }),
    useSetAiFeature: () => ({ mutate: jest.fn(), isPending: false }),
  }
})

// Mock environment variables
process.env.NEXTAUTH_URL = 'http://localhost:3000'
process.env.NEXTAUTH_SECRET = 'test-secret'
process.env.GOOGLE_CLIENT_ID = 'test-client-id'
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret'
process.env.SUPA_POSTGRES_PRISMA_URL =
  'postgresql://test:test@localhost:5432/test'
process.env.ACCESS_TOKEN_KEY = 'test-access-token-key-32-chars'
process.env.REFRESH_TOKEN_KEY = 'test-refresh-token-key-32-chars'
// LUM-1025: suites run as if on Vercel, so Sandbox / Chromium count as
// configured and the security-scan layers keep their default-on behaviour.
// Tests of the unconfigured path pass an explicit env without it.
process.env.VERCEL = '1'
// LUM-1043: `.env` (cp .env.example .env for docker compose) sets
// AUTH_PROVIDER=better-auth and next/jest loads it. Suites start on the
// default provider; Better Auth suites set AUTH_PROVIDER themselves.
delete process.env.AUTH_PROVIDER

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
    // LUM-1334: every DONE transition reads the workspace's requirement
    // switches; no row reads as both off.
    workspace: {
      findUnique: jest.fn(),
    },
  })),
}))
