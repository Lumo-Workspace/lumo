# Testing Patterns

**Analysis Date:** 2026-04-09

## Test Framework

**Runner:**

- Jest 30.3.0
- Config: `jest.config.js` (root)
- Test environment: jsdom (for browser-like testing)

**Assertion Library:**

- Jest built-in matchers: `expect()`, `toEqual()`, `toHaveBeenCalled()`, `toMatchObject()`, etc.
- Testing Library: `@testing-library/react` (16.3.2) + `@testing-library/jest-dom` (6.9.1) for DOM assertions
- `jest-mock-extended` (4.0.0) for advanced mocking

**Run Commands:**

```bash
npm test              # Run all tests
npm run test:watch   # Watch mode
npm run test:coverage # Generate coverage report
```

## Test File Organization

**Location:**

- Co-located with source code: `__tests__/` directory at project root
- File path: `__tests__/{feature}.test.ts` (e.g., `__tests__/document.repository.test.ts`)

**Naming:**

- Always `.test.ts` (not `.spec.ts`)
- Match source name: `document.service.ts` → `document.service.test.ts`

**Structure:**

```
__tests__/
├── document.repository.test.ts
├── document.service.test.ts
├── invite.repository.test.ts
├── invite.service.test.ts
├── member.service.test.ts
├── view.service.test.ts
└── ...
```

## Test Structure

**Suite Organization (from actual code):**

```typescript
import { documentRepository } from '@/lib/repositories/document.repository'

// ── Mock Prisma ─────────────────────────────────────────────────────────────
const mockFindMany = jest.fn()
const mockFindFirst = jest.fn()
const mockFindUnique = jest.fn()
const mockCreate = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    document: {
      findMany: (...args: any[]) => mockFindMany(...args),
      findFirst: (...args: any[]) => mockFindFirst(...args),
      findUnique: (...args: any[]) => mockUnique(...args),
      create: (...args: any[]) => mockCreate(...args),
    },
  },
}))

beforeEach(() => jest.clearAllMocks())

// ── Tests ───────────────────────────────────────────────────────────────────
describe('documentRepository', () => {
  describe('findByWorkspace', () => {
    it('queries with permission filter', async () => {
      mockFindMany.mockResolvedValue([])

      await documentRepository.findByWorkspace('ws-1', 'member-1')

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            workspaceId: 'ws-1',
            OR: [...]
          })
        })
      )
    })
  })
})
```

**Patterns:**

- All mocks declared at top under `// ── Mock dependencies ──────────────` comment
- `beforeEach(() => jest.clearAllMocks())` to isolate tests
- Nested `describe()` blocks group related tests by method
- One assertion per test (or tightly related assertions)

## Mocking

**Framework:** jest.mock() with custom mock functions

**Patterns (from codebase):**

**Repository Mocking (in service tests):**

```typescript
const mockFindWithPermission = jest.fn()
const mockCreate = jest.fn()

jest.mock('@/lib/repositories/document.repository', () => ({
  documentRepository: {
    findWithPermission: (...args: any[]) => mockFindWithPermission(...args),
    create: (...args: any[]) => mockCreate(...args),
  },
}))

// In test:
mockFindWithPermission.mockResolvedValue({ id: 'doc-1', title: 'Test' })
const result = await documentService.getDocument('doc-1', 'm-1', 'ws-1')
expect(result.document.id).toBe('doc-1')
```

**Prisma Mocking (when testing database-touching code):**

```typescript
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    $transaction: jest.fn((fn: any) =>
      fn({
        document: {
          update: jest.fn().mockResolvedValue({ id: 'doc-1' }),
          findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'doc-1' }),
        },
        documentMention: {
          findMany: jest.fn().mockResolvedValue([]),
          deleteMany: jest.fn(),
          createMany: jest.fn(),
        },
      })
    ),
  },
}))
```

**External Service Mocking (Clerk, etc.):**

```typescript
// Code reaches Clerk only through @/lib/auth (LUM-1026); mocking the
// interface keeps the test independent of the auth provider.
jest.mock('@/lib/auth/users', () => ({
  getUserDirectory: jest.fn().mockResolvedValue({
    getUserList: jest.fn().mockResolvedValue({ data: [] }),
  }),
}))
```

**What to Mock:**

- External dependencies (APIs, SDKs)
- Expensive operations (database calls, HTTP requests)
- Time-dependent functions (when testing logic, not timing)

**What NOT to Mock:**

- Internal business logic (test the actual service/repository, not a mock)
- Pure functions (no need; they're deterministic)
- Simple utilities unless they have side effects

## Fixtures and Factories

**Test Data:**
Currently no formal factory pattern; tests create inline objects:

```typescript
const fakeDoc = { id: 'doc-1', title: 'Test' }
mockFindMany.mockResolvedValue([fakeDoc])
```

**Location:**
Test data created inline in test files. For future growth, consider extracting to `__tests__/fixtures/` directory.

**Pattern (observed):**

- Use descriptive variable names: `fakeDoc`, `fakeDocWithShares`
- Only include fields needed for the test
- Use `mockResolvedValue()` / `mockResolvedValueOnce()` for sequenced responses

## Coverage

**Requirements:** 80% threshold globally

- Branches: 80%
- Functions: 80%
- Lines: 80%
- Statements: 80%

**Configuration (jest.config.js):**

```javascript
collectCoverageFrom: [
  'app/**/*.{js,jsx,ts,tsx}',
  'components/**/*.{js,jsx,ts,tsx}',
  'lib/**/*.{js,jsx,ts,tsx}',
  '!**/*.d.ts',
  '!**/node_modules/**',
],
coverageThreshold: {
  global: {
    branches: 80,
    functions: 80,
    lines: 80,
    statements: 80,
  },
}
```

**View Coverage:**

```bash
npm run test:coverage
# Opens coverage/ directory with HTML report
```

## Test Types

**Unit Tests (Primary):**

- Test individual functions in isolation (services, repositories, utilities)
- Mock all external dependencies
- Located in `__tests__/` directory
- Example: `__tests__/document.service.test.ts` tests service methods with mocked repositories

**Integration Tests:**

- Not heavily present in current codebase
- Future: would test API routes calling services + mocked repositories
- Would verify request validation (Zod) + service orchestration

**E2E Tests:**

- Not currently used
- Future candidates: Next.js app router pages, full request lifecycle

## Common Patterns

**Async Testing (await + expect):**

```typescript
it('returns enriched documents from repository', async () => {
  mockFindByWorkspace.mockResolvedValue([{ id: 'doc-1', title: 'Test' }])

  const result = await documentService.listDocuments('ws-1', 'm-1')

  expect(result).toHaveLength(1)
  expect(result[0]!.id).toBe('doc-1')
})
```

**Error Testing (rejects.toMatchObject):**

```typescript
it('throws 404 when document not found', async () => {
  mockFindWithPermission.mockResolvedValue(null)

  await expect(
    documentService.getDocument('doc-missing', 'm-1', 'ws-1')
  ).rejects.toMatchObject({
    message: 'Document not found',
    status: 404,
  })
})
```

**Spying on Calls (toHaveBeenCalledWith):**

```typescript
it('passes filters to repository', async () => {
  mockFindByWorkspace.mockResolvedValue([])

  await documentService.listDocuments('ws-1', 'm-1', {
    visibility: 'PRIVATE',
    search: 'test',
  })

  expect(mockFindByWorkspace).toHaveBeenCalledWith('ws-1', 'm-1', {
    visibility: 'PRIVATE',
    search: 'test',
  })
})
```

**Argument Matching (expect.objectContaining):**

```typescript
it('queries with permission filter', async () => {
  mockFindMany.mockResolvedValue([])

  await documentRepository.findByWorkspace('ws-1', 'member-1')

  expect(mockFindMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        workspaceId: 'ws-1',
        OR: [
          { createdById: 'member-1' },
          { visibility: 'WORKSPACE' },
          { shares: { some: { memberId: 'member-1' } } },
        ],
      }),
    })
  )
})
```

**Sequential Mock Values (mockResolvedValueOnce):**

```typescript
it('deletes pending invites and creates new ones', async () => {
  mockCreate
    .mockResolvedValueOnce({ id: 'inv-1', token: 'tok-1' })
    .mockResolvedValueOnce({ id: 'inv-2', token: 'tok-2' })

  const results = await inviteService.createInvites('ws-1', ['a@b.com', 'c@d.com'], ...)

  expect(results).toHaveLength(2)
  expect(mockCreate).toHaveBeenCalledTimes(2)
})
```

## Jest Setup

**Setup File:** `jest.setup.js`

**Mocks Applied Globally:**

```typescript
// Next.js router (all tests)
jest.mock('next/navigation', () => ({
  useRouter() { ... },
  useSearchParams() { return new URLSearchParams() },
  usePathname() { return '/' },
}))

// Next.js Image component
jest.mock('next/image', () => ({
  __esModule: true,
  default: props => <img {...props} />,
}))

// Environment variables (test-safe defaults)
process.env.NEXTAUTH_URL = 'http://localhost:3000'
process.env.GOOGLE_CLIENT_ID = 'test-client-id'
// ... other vars

// Prisma Client (mock by default)
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    user: { create: jest.fn(), ... },
    // ... all models
  })),
}))
```

## Test Execution

**Pre-commit Hook:**
Tests run via `lint-staged` on staged TypeScript files:

```json
"*.{js,jsx,ts,tsx}": [
  "eslint --fix",
  "prettier --write"
]
```

**Note:** Tests are not part of lint-staged; run manually via `npm test` before committing.

---

_Testing analysis: 2026-04-09_
