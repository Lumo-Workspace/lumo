# Figma Task Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attach Figma file/frame URLs to a Task with structured metadata (file name, frame name, thumbnail) fetched via per-member OAuth, surfaced in `lumo task context <id>` as a "Figma Designs" section. Manual + lazy refresh, no cron.

**Architecture:** Layered: CLI / Web UI → API Route (thin) → Service (business logic) → Repository (Prisma). OAuth + HTTP client in `lib/integrations/figma/`, mirroring `lib/integrations/github/`. New tables: `FigmaIntegration` (per `(workspaceId, memberId)`) and `TaskFigmaLink` (with `(taskId, fileKey, nodeId)` unique).

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Prisma 5, Neon Postgres, Jest, commander.js (CLI). Figma REST API (`/v1/files`, `/v1/images`).

**Spec:** [docs/superpowers/specs/2026-05-28-figma-task-context-design.md](../specs/2026-05-28-figma-task-context-design.md)

---

## File Structure

### New files

- `prisma/migrations/<timestamp>_add_figma_integration_and_task_figma_link/migration.sql`
- `lib/integrations/figma/parse-url.ts` — pure URL parser
- `lib/integrations/figma/oauth.ts` — `getAuthorizeUrl`, `exchangeCode`, `refreshAccessToken`
- `lib/integrations/figma/client.ts` — REST client with auto-refresh wrapper
- `lib/integrations/figma/types.ts` — Figma API response types
- `lib/repositories/task-figma-link.repository.ts`
- `lib/repositories/figma-integration.repository.ts`
- `lib/services/task-figma-link.service.ts`
- `lib/services/figma-integration.service.ts`
- `lib/validation/task-figma-link.ts` — Zod schemas
- `app/api/figma/oauth/route.ts`
- `app/api/figma/callback/route.ts`
- `app/api/figma/integration/route.ts` — GET (status) + DELETE (disconnect)
- `app/api/tasks/[id]/figma/route.ts` — GET (list) + POST (add)
- `app/api/tasks/[id]/figma/[linkId]/route.ts` — DELETE
- `app/api/tasks/[id]/figma/refresh/route.ts` — POST
- `app/workspace/[workspaceUrl]/settings/integrations/figma/page.tsx` — connect UI
- `cli/src/commands/task-figma-add.ts`
- `cli/src/commands/task-figma-list.ts`
- `cli/src/commands/task-figma-rm.ts`
- `cli/src/commands/task-figma-refresh.ts`
- `cli/src/lib/figma-api.ts` — CLI fetch helpers (mirrors patterns from `cli/src/commands/doc-create.ts`)
- `__tests__/lib/integrations/figma/parse-url.test.ts`
- `__tests__/lib/integrations/figma/oauth.test.ts`
- `__tests__/lib/integrations/figma/client.test.ts`
- `__tests__/lib/services/task-figma-link.service.test.ts`
- `__tests__/lib/services/figma-integration.service.test.ts`
- `__tests__/lib/repositories/task-figma-link.repository.test.ts`
- `__tests__/app/api/figma/callback.test.ts`
- `__tests__/app/api/tasks/figma.test.ts`

### Modified files

- `prisma/schema.prisma` — add `FigmaIntegration`, `TaskFigmaLink`, inverse relations on `Workspace`, `WorkspaceMember`, `Task`
- `lib/services/task-context.service.ts` — add `renderFigmaSection`, include in response, lazy-refresh hook
- `app/api/tasks/context/[identifier]/route.ts` — no change expected (service returns the new field)
- `cli/src/index.ts` — register `task figma {add|list|rm|refresh}` subcommands
- `cli/src/commands/task-context.ts` — render `figmaSection` field from response
- `.claude/skills/lumo/SKILL.md` — new section + trigger keywords
- `app/workspace/[workspaceUrl]/settings/integrations/page.tsx` (if exists) — add "Figma" tile linking to new sub-page; else create

### Env vars (Vercel + local `.env`)

- `FIGMA_OAUTH_CLIENT_ID`
- `FIGMA_OAUTH_CLIENT_SECRET`
- `FIGMA_OAUTH_REDIRECT_URI` (e.g. `https://www.uselumo.ai/api/figma/callback`)

State token uses `lib/crypto.ts` (`encrypt(JSON.stringify(...))`), the same scheme GitHub OAuth uses — no new secret needed. `NEXT_PUBLIC_APP_URL` already exists in Vercel and is referenced for the callback redirect.

---

## Task 1: Prisma schema + migration

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_figma_integration_and_task_figma_link/migration.sql`

- [ ] **Step 1: Add `FigmaIntegration` and `TaskFigmaLink` models to `prisma/schema.prisma`**

Append at the end of the schema file (or near the other `*Integration` models around line 690):

```prisma
model FigmaIntegration {
  id            String   @id @default(cuid())
  workspaceId   String
  memberId      String
  accessToken   String   // AES-256-GCM encrypted via lib/crypto.ts
  refreshToken  String   // same encryption
  expiresAt     DateTime
  figmaUserId   String
  figmaHandle   String
  figmaEmail    String?
  scopes        String[]
  needsReauth   Boolean  @default(false)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  workspace  Workspace       @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  member     WorkspaceMember @relation(fields: [memberId], references: [id], onDelete: Cascade)
  figmaLinks TaskFigmaLink[]

  @@unique([workspaceId, memberId])
  @@index([workspaceId])
  @@map("figma_integrations")
}

model TaskFigmaLink {
  id                 String   @id @default(cuid())
  taskId             String
  workspaceId        String
  createdById        String
  integrationId      String?

  url                String
  fileKey            String
  nodeId             String   // "" = file-level (sentinel, see spec §2)
  fileName           String
  frameName          String?
  thumbnailUrl       String?
  thumbnailFetchedAt DateTime?
  lastSyncedAt       DateTime @default(now())
  lastSyncError      String?

  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  task        Task              @relation(fields: [taskId], references: [id], onDelete: Cascade)
  workspace   Workspace         @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  createdBy   WorkspaceMember   @relation(fields: [createdById], references: [id], onDelete: Restrict)
  integration FigmaIntegration? @relation(fields: [integrationId], references: [id], onDelete: SetNull)

  @@unique([taskId, fileKey, nodeId])
  @@index([taskId])
  @@index([workspaceId])
  @@map("task_figma_links")
}
```

- [ ] **Step 2: Add inverse relations on existing models**

Find `model Workspace`, `model WorkspaceMember`, and `model Task` in `prisma/schema.prisma` and add:

```prisma
// In model Workspace:
figmaIntegrations FigmaIntegration[]
taskFigmaLinks    TaskFigmaLink[]

// In model WorkspaceMember:
figmaIntegrations FigmaIntegration[]
taskFigmaLinks    TaskFigmaLink[]

// In model Task:
figmaLinks TaskFigmaLink[]
```

- [ ] **Step 3: Generate the migration**

Run: `npx prisma migrate dev --name add_figma_integration_and_task_figma_link --create-only`

Expected: a new directory under `prisma/migrations/` with a `migration.sql` containing `CREATE TABLE "figma_integrations"` and `CREATE TABLE "task_figma_links"`. Inspect the SQL to confirm there is no destructive change.

- [ ] **Step 4: Apply locally**

Run: `npx prisma migrate dev`

If the local DB hits drift (P3008 / P3012), follow the [CLAUDE.md workaround](../../../CLAUDE.md) (hand-write the SQL + `db execute` + `migrate resolve --applied`). **Never** `migrate reset`.

- [ ] **Step 5: Regenerate Prisma client and run typecheck**

Run: `npx prisma generate && npx tsc --noEmit`

Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add FigmaIntegration + TaskFigmaLink schema [LUM-104]"
```

---

## Task 2: `parseFigmaUrl` utility + tests

**Files:**

- Create: `lib/integrations/figma/parse-url.ts`
- Test: `__tests__/lib/integrations/figma/parse-url.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/integrations/figma/parse-url.test.ts`:

```ts
import { parseFigmaUrl } from '@/lib/integrations/figma/parse-url'

describe('parseFigmaUrl', () => {
  it('parses /file/ URL with node-id', () => {
    expect(
      parseFigmaUrl(
        'https://www.figma.com/file/abc123/Onboarding?node-id=1-234'
      )
    ).toEqual({ fileKey: 'abc123', nodeId: '1:234' })
  })

  it('parses /design/ URL (new format)', () => {
    expect(
      parseFigmaUrl(
        'https://www.figma.com/design/abc123/Onboarding?node-id=1-234'
      )
    ).toEqual({ fileKey: 'abc123', nodeId: '1:234' })
  })

  it('parses /proto/ URL', () => {
    expect(
      parseFigmaUrl(
        'https://www.figma.com/proto/abc123/Onboarding?node-id=2-456'
      )
    ).toEqual({ fileKey: 'abc123', nodeId: '2:456' })
  })

  it('returns null nodeId when query missing', () => {
    expect(
      parseFigmaUrl('https://www.figma.com/file/abc123/Onboarding')
    ).toEqual({ fileKey: 'abc123', nodeId: null })
  })

  it('normalizes %3A in node-id to colon', () => {
    expect(
      parseFigmaUrl(
        'https://www.figma.com/file/abc123/Onboarding?node-id=1%3A234'
      )
    ).toEqual({ fileKey: 'abc123', nodeId: '1:234' })
  })

  it('returns null for non-figma URL', () => {
    expect(parseFigmaUrl('https://example.com/abc')).toBeNull()
  })

  it('returns null for figma URL missing file key', () => {
    expect(parseFigmaUrl('https://www.figma.com/community/file')).toBeNull()
  })

  it('returns null for unparseable input', () => {
    expect(parseFigmaUrl('not a url')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- parse-url`

Expected: FAIL — `parseFigmaUrl` cannot be found.

- [ ] **Step 3: Write implementation**

Create `lib/integrations/figma/parse-url.ts`:

```ts
export interface ParsedFigmaUrl {
  fileKey: string
  nodeId: string | null
}

const FIGMA_HOSTS = ['www.figma.com', 'figma.com']
const PATH_PATTERN = /^\/(file|design|proto)\/([^/?#]+)/

export function parseFigmaUrl(input: string): ParsedFigmaUrl | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (!FIGMA_HOSTS.includes(url.hostname.toLowerCase())) return null

  const match = url.pathname.match(PATH_PATTERN)
  if (!match) return null
  const fileKey = match[2]

  const raw = url.searchParams.get('node-id')
  const nodeId = raw ? raw.replace(/-/g, ':').replace(/%3A/gi, ':') : null
  return { fileKey, nodeId }
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test -- parse-url`

Expected: PASS, 8/8.

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/figma/parse-url.ts __tests__/lib/integrations/figma/parse-url.test.ts
git commit -m "feat: parseFigmaUrl utility with node-id normalization [LUM-104]"
```

---

## Task 3: Figma OAuth helpers + tests

**Files:**

- Create: `lib/integrations/figma/oauth.ts`
- Create: `lib/integrations/figma/types.ts`
- Test: `__tests__/lib/integrations/figma/oauth.test.ts`

Reference: skim `app/api/github/oauth/route.ts` and `app/api/github/callback/route.ts` before starting — Figma mirrors that flow.

- [ ] **Step 1: Define API response types**

Create `lib/integrations/figma/types.ts`:

```ts
export interface FigmaTokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number // seconds
  user_id: string
}

export interface FigmaUserInfo {
  id: string
  email: string
  handle: string
  img_url: string
}

export interface FigmaFileResponse {
  name: string
  document: {
    children: Array<{
      type: 'CANVAS'
      children?: Array<{ id: string; name: string; type: string }>
    }>
  }
}

export interface FigmaNodesResponse {
  nodes: Record<string, { document: { name: string; type: string } } | null>
}

export interface FigmaImagesResponse {
  err: string | null
  images: Record<string, string | null> // nodeId → URL
}
```

- [ ] **Step 2: Write failing test for `getAuthorizeUrl`**

Create `__tests__/lib/integrations/figma/oauth.test.ts`:

```ts
import {
  getAuthorizeUrl,
  exchangeCode,
  refreshAccessToken,
} from '@/lib/integrations/figma/oauth'

describe('getAuthorizeUrl', () => {
  beforeAll(() => {
    process.env.FIGMA_OAUTH_CLIENT_ID = 'test-client-id'
    process.env.FIGMA_OAUTH_REDIRECT_URI =
      'https://lumo.test/api/figma/callback'
  })

  it('builds Figma authorize URL with required params', () => {
    const url = new URL(getAuthorizeUrl({ state: 'abc' }))
    expect(url.origin + url.pathname).toBe('https://www.figma.com/oauth')
    expect(url.searchParams.get('client_id')).toBe('test-client-id')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://lumo.test/api/figma/callback'
    )
    expect(url.searchParams.get('scope')).toBe('files:read')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('state')).toBe('abc')
  })
})
```

- [ ] **Step 3: Run, verify it fails**

Run: `npm test -- figma/oauth`

Expected: FAIL (module not found).

- [ ] **Step 4: Implement `getAuthorizeUrl`**

Create `lib/integrations/figma/oauth.ts`:

```ts
import type { FigmaTokenResponse } from './types'

const FIGMA_OAUTH_BASE = 'https://www.figma.com/oauth'
const FIGMA_TOKEN_URL = 'https://api.figma.com/v1/oauth/token'

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var: ${name}`)
  return v
}

export function getAuthorizeUrl(opts: { state: string }): string {
  const url = new URL(FIGMA_OAUTH_BASE)
  url.searchParams.set('client_id', requireEnv('FIGMA_OAUTH_CLIENT_ID'))
  url.searchParams.set('redirect_uri', requireEnv('FIGMA_OAUTH_REDIRECT_URI'))
  url.searchParams.set('scope', 'files:read')
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', opts.state)
  return url.toString()
}

export async function exchangeCode(code: string): Promise<FigmaTokenResponse> {
  const body = new URLSearchParams({
    client_id: requireEnv('FIGMA_OAUTH_CLIENT_ID'),
    client_secret: requireEnv('FIGMA_OAUTH_CLIENT_SECRET'),
    redirect_uri: requireEnv('FIGMA_OAUTH_REDIRECT_URI'),
    code,
    grant_type: 'authorization_code',
  })
  const res = await fetch(FIGMA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`Figma token exchange failed: ${res.status}`)
  return (await res.json()) as FigmaTokenResponse
}

export async function refreshAccessToken(
  refreshToken: string
): Promise<FigmaTokenResponse> {
  const body = new URLSearchParams({
    client_id: requireEnv('FIGMA_OAUTH_CLIENT_ID'),
    client_secret: requireEnv('FIGMA_OAUTH_CLIENT_SECRET'),
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })
  const res = await fetch(FIGMA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`Figma token refresh failed: ${res.status}`)
  return (await res.json()) as FigmaTokenResponse
}
```

- [ ] **Step 5: Write tests for `exchangeCode` and `refreshAccessToken`**

Append to `__tests__/lib/integrations/figma/oauth.test.ts`:

```ts
describe('exchangeCode', () => {
  beforeAll(() => {
    process.env.FIGMA_OAUTH_CLIENT_SECRET = 'test-secret'
  })

  it('POSTs form body and returns token response', async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'at',
        refresh_token: 'rt',
        expires_in: 3600,
        user_id: 'u1',
      }),
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await exchangeCode('the-code')

    expect(result.access_token).toBe('at')
    const [, init] = fetchMock.mock.calls[0]
    const body = init.body as URLSearchParams
    expect(body.get('code')).toBe('the-code')
    expect(body.get('grant_type')).toBe('authorization_code')
  })

  it('throws on non-2xx', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
    }) as unknown as typeof fetch
    await expect(exchangeCode('bad')).rejects.toThrow(/400/)
  })
})

describe('refreshAccessToken', () => {
  it('POSTs refresh grant', async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'at2',
        refresh_token: 'rt2',
        expires_in: 3600,
        user_id: 'u1',
      }),
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await refreshAccessToken('rt')
    expect(result.access_token).toBe('at2')
    const [, init] = fetchMock.mock.calls[0]
    const body = init.body as URLSearchParams
    expect(body.get('refresh_token')).toBe('rt')
    expect(body.get('grant_type')).toBe('refresh_token')
  })
})
```

- [ ] **Step 6: Run all OAuth tests**

Run: `npm test -- figma/oauth`

Expected: PASS, all describe blocks.

- [ ] **Step 7: Commit**

```bash
git add lib/integrations/figma/oauth.ts lib/integrations/figma/types.ts __tests__/lib/integrations/figma/oauth.test.ts
git commit -m "feat: figma OAuth authorize/exchange/refresh helpers [LUM-104]"
```

---

## Task 4: Figma API client with auto-refresh

**Files:**

- Create: `lib/integrations/figma/client.ts`
- Test: `__tests__/lib/integrations/figma/client.test.ts`

The client receives a `FigmaIntegration` record (already-decrypted token + expiresAt), calls Figma REST endpoints, and auto-refreshes the token when expired. On second 401 (refresh-then-retry still 401), throws `FigmaNeedsReauthError`.

- [ ] **Step 1: Write failing test for happy-path `getFile`**

Create `__tests__/lib/integrations/figma/client.test.ts`:

```ts
import {
  createFigmaClient,
  FigmaNeedsReauthError,
} from '@/lib/integrations/figma/client'

interface Tokens {
  accessToken: string
  refreshToken: string
  expiresAt: Date
}

function makeTokens(overrides: Partial<Tokens> = {}): Tokens {
  return {
    accessToken: 'at',
    refreshToken: 'rt',
    expiresAt: new Date(Date.now() + 3600_000),
    ...overrides,
  }
}

describe('FigmaClient.getFile', () => {
  it('calls /v1/files/:key with Bearer token', async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ name: 'My File', document: { children: [] } }),
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const client = createFigmaClient({
      tokens: makeTokens(),
      onTokensRefreshed: jest.fn(),
    })
    const file = await client.getFile('abc123')

    expect(file.name).toBe('My File')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.figma.com/v1/files/abc123?depth=1')
    expect(init.headers.Authorization).toBe('Bearer at')
  })
})
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- figma/client`

Expected: FAIL.

- [ ] **Step 3: Implement minimal client (happy path only)**

Create `lib/integrations/figma/client.ts`:

```ts
import { refreshAccessToken } from './oauth'
import type {
  FigmaFileResponse,
  FigmaNodesResponse,
  FigmaImagesResponse,
} from './types'

export class FigmaNeedsReauthError extends Error {
  constructor() {
    super('Figma integration needs re-auth')
    this.name = 'FigmaNeedsReauthError'
  }
}

export interface FigmaClientTokens {
  accessToken: string
  refreshToken: string
  expiresAt: Date
}

export interface FigmaClient {
  getFile(fileKey: string): Promise<FigmaFileResponse>
  getNode(fileKey: string, nodeId: string): Promise<FigmaNodesResponse>
  getImage(fileKey: string, nodeId: string): Promise<string | null>
}

const FIGMA_API_BASE = 'https://api.figma.com/v1'
const REFRESH_THRESHOLD_MS = 60_000

export function createFigmaClient(opts: {
  tokens: FigmaClientTokens
  onTokensRefreshed: (next: FigmaClientTokens) => Promise<void>
}): FigmaClient {
  let tokens = opts.tokens

  async function ensureFresh(): Promise<void> {
    if (tokens.expiresAt.getTime() - Date.now() > REFRESH_THRESHOLD_MS) return
    const next = await refreshAccessToken(tokens.refreshToken)
    tokens = {
      accessToken: next.access_token,
      refreshToken: next.refresh_token,
      expiresAt: new Date(Date.now() + next.expires_in * 1000),
    }
    await opts.onTokensRefreshed(tokens)
  }

  async function call<T>(path: string): Promise<T> {
    await ensureFresh()
    let res = await fetch(`${FIGMA_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    })
    if (res.status === 401) {
      const next = await refreshAccessToken(tokens.refreshToken).catch(
        () => null
      )
      if (!next) throw new FigmaNeedsReauthError()
      tokens = {
        accessToken: next.access_token,
        refreshToken: next.refresh_token,
        expiresAt: new Date(Date.now() + next.expires_in * 1000),
      }
      await opts.onTokensRefreshed(tokens)
      res = await fetch(`${FIGMA_API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      })
      if (res.status === 401) throw new FigmaNeedsReauthError()
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      const err = new Error(
        `Figma API ${res.status}: ${body.slice(0, 200)}`
      ) as Error & { status: number }
      err.status = res.status
      throw err
    }
    return (await res.json()) as T
  }

  return {
    getFile(fileKey) {
      return call<FigmaFileResponse>(`/files/${fileKey}?depth=1`)
    },
    getNode(fileKey, nodeId) {
      const ids = encodeURIComponent(nodeId)
      return call<FigmaNodesResponse>(`/files/${fileKey}/nodes?ids=${ids}`)
    },
    async getImage(fileKey, nodeId) {
      const ids = encodeURIComponent(nodeId)
      const res = await call<FigmaImagesResponse>(
        `/images/${fileKey}?ids=${ids}&format=png&scale=2`
      )
      return res.images[nodeId] ?? null
    },
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npm test -- figma/client`

Expected: PASS 1/1.

- [ ] **Step 5: Add tests for refresh-on-expiry and double-401**

Append to `__tests__/lib/integrations/figma/client.test.ts`:

```ts
describe('FigmaClient refresh behavior', () => {
  it('refreshes token preemptively when expired', async () => {
    const refreshFetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'at2',
        refresh_token: 'rt2',
        expires_in: 3600,
        user_id: 'u1',
      }),
    })
    const apiFetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ name: 'F', document: { children: [] } }),
    })
    global.fetch = jest
      .fn()
      .mockImplementationOnce(refreshFetch)
      .mockImplementationOnce(apiFetch) as unknown as typeof fetch
    process.env.FIGMA_OAUTH_CLIENT_ID = 'cid'
    process.env.FIGMA_OAUTH_CLIENT_SECRET = 'sec'

    const onRefreshed = jest.fn()
    const client = createFigmaClient({
      tokens: makeTokens({ expiresAt: new Date(Date.now() - 1000) }),
      onTokensRefreshed: onRefreshed,
    })
    await client.getFile('abc')
    expect(onRefreshed).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'at2' })
    )
  })

  it('throws FigmaNeedsReauthError after refresh+retry both 401', async () => {
    process.env.FIGMA_OAUTH_CLIENT_ID = 'cid'
    process.env.FIGMA_OAUTH_CLIENT_SECRET = 'sec'
    global.fetch = jest
      .fn()
      // first call: 401
      .mockResolvedValueOnce({ ok: false, status: 401, text: async () => '' })
      // refresh call: 200
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'at2',
          refresh_token: 'rt2',
          expires_in: 3600,
          user_id: 'u1',
        }),
      })
      // retry call: still 401
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => '',
      }) as unknown as typeof fetch

    const client = createFigmaClient({
      tokens: makeTokens(),
      onTokensRefreshed: jest.fn(),
    })
    await expect(client.getFile('abc')).rejects.toBeInstanceOf(
      FigmaNeedsReauthError
    )
  })
})
```

- [ ] **Step 6: Run all client tests**

Run: `npm test -- figma/client`

Expected: PASS, all describe blocks.

- [ ] **Step 7: Commit**

```bash
git add lib/integrations/figma/client.ts __tests__/lib/integrations/figma/client.test.ts
git commit -m "feat: figma REST client with auto-refresh + reauth detection [LUM-104]"
```

---

## Task 5: `figmaIntegrationRepository` + `taskFigmaLinkRepository`

**Files:**

- Create: `lib/repositories/figma-integration.repository.ts`
- Create: `lib/repositories/task-figma-link.repository.ts`
- Test: `__tests__/lib/repositories/task-figma-link.repository.test.ts`

- [ ] **Step 1: Implement `figmaIntegrationRepository`**

Create `lib/repositories/figma-integration.repository.ts`:

```ts
import { prisma } from '@/lib/db/prisma'
import type { FigmaIntegration } from '@prisma/client'

export const figmaIntegrationRepository = {
  findByMember(
    workspaceId: string,
    memberId: string
  ): Promise<FigmaIntegration | null> {
    return prisma.figmaIntegration.findUnique({
      where: { workspaceId_memberId: { workspaceId, memberId } },
    })
  },

  findAnyForWorkspace(workspaceId: string): Promise<FigmaIntegration | null> {
    return prisma.figmaIntegration.findFirst({
      where: { workspaceId, needsReauth: false },
      orderBy: { updatedAt: 'desc' },
    })
  },

  upsert(input: {
    workspaceId: string
    memberId: string
    accessToken: string
    refreshToken: string
    expiresAt: Date
    figmaUserId: string
    figmaHandle: string
    figmaEmail: string | null
    scopes: string[]
  }): Promise<FigmaIntegration> {
    const { workspaceId, memberId, ...data } = input
    return prisma.figmaIntegration.upsert({
      where: { workspaceId_memberId: { workspaceId, memberId } },
      create: { workspaceId, memberId, ...data, needsReauth: false },
      update: { ...data, needsReauth: false },
    })
  },

  updateTokens(
    id: string,
    next: { accessToken: string; refreshToken: string; expiresAt: Date }
  ): Promise<FigmaIntegration> {
    return prisma.figmaIntegration.update({ where: { id }, data: next })
  },

  markNeedsReauth(id: string): Promise<FigmaIntegration> {
    return prisma.figmaIntegration.update({
      where: { id },
      data: { needsReauth: true },
    })
  },

  delete(workspaceId: string, memberId: string): Promise<void> {
    prisma.figmaIntegration
      .delete({ where: { workspaceId_memberId: { workspaceId, memberId } } })
      .catch(() => null) // idempotent
    return Promise.resolve()
  },
}
```

- [ ] **Step 2: Write failing repository test**

Create `__tests__/lib/repositories/task-figma-link.repository.test.ts` (follows the project's mocked-prisma pattern — see `__tests__/lib/repositories/activity.repository.test.ts` for reference):

```ts
/**
 * @jest-environment node
 */

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    taskFigmaLink: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { taskFigmaLinkRepository } from '@/lib/repositories/task-figma-link.repository'

const mockCreate = prisma.taskFigmaLink.create as jest.Mock
const mockFindMany = prisma.taskFigmaLink.findMany as jest.Mock
const mockFindUnique = prisma.taskFigmaLink.findUnique as jest.Mock
const mockUpdate = prisma.taskFigmaLink.update as jest.Mock
const mockDelete = prisma.taskFigmaLink.delete as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('taskFigmaLinkRepository.create', () => {
  it('forwards input as create data', async () => {
    mockCreate.mockResolvedValue({ id: 'cfl_1' })
    const input = {
      taskId: 't1',
      workspaceId: 'w1',
      createdById: 'm1',
      url: 'https://www.figma.com/file/abc/F?node-id=1-2',
      fileKey: 'abc',
      nodeId: '1:2',
      fileName: 'F',
      frameName: 'Welcome',
    }
    await taskFigmaLinkRepository.create(input)
    expect(mockCreate).toHaveBeenCalledWith({ data: input })
  })
})

describe('taskFigmaLinkRepository.listByTask', () => {
  it('queries by taskId ordered by createdAt asc', async () => {
    mockFindMany.mockResolvedValue([])
    await taskFigmaLinkRepository.listByTask('t1')
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { taskId: 't1' },
      orderBy: { createdAt: 'asc' },
    })
  })
})

describe('taskFigmaLinkRepository.findByTaskAndKey', () => {
  it('uses the compound unique key', async () => {
    mockFindUnique.mockResolvedValue(null)
    await taskFigmaLinkRepository.findByTaskAndKey('t1', 'abc', '1:2')
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: {
        taskId_fileKey_nodeId: { taskId: 't1', fileKey: 'abc', nodeId: '1:2' },
      },
    })
  })

  it('uses "" sentinel for file-level lookup', async () => {
    mockFindUnique.mockResolvedValue(null)
    await taskFigmaLinkRepository.findByTaskAndKey('t1', 'abc', '')
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: {
        taskId_fileKey_nodeId: { taskId: 't1', fileKey: 'abc', nodeId: '' },
      },
    })
  })
})

describe('taskFigmaLinkRepository.update', () => {
  it('updates by id with the supplied data', async () => {
    mockUpdate.mockResolvedValue({ id: 'cfl_1' })
    await taskFigmaLinkRepository.update('cfl_1', {
      thumbnailUrl: 'https://x/y.png',
      lastSyncedAt: new Date(0),
    })
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'cfl_1' },
      data: { thumbnailUrl: 'https://x/y.png', lastSyncedAt: new Date(0) },
    })
  })
})

describe('taskFigmaLinkRepository.delete', () => {
  it('deletes by id', async () => {
    mockDelete.mockResolvedValue(undefined)
    await taskFigmaLinkRepository.delete('cfl_1')
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: 'cfl_1' } })
  })
})
```

The `(taskId, fileKey, nodeId)` uniqueness constraint is enforced at the DB layer; the Prisma-level test verifies the repository calls the right method with the right shape. A real-DB integration test for the unique constraint can be added later if needed — the project currently mocks prisma for repository tests.

- [ ] **Step 3: Run, verify fail**

Run: `npm test -- task-figma-link.repository`

Expected: FAIL (module not found).

- [ ] **Step 4: Implement `taskFigmaLinkRepository`**

Create `lib/repositories/task-figma-link.repository.ts`:

```ts
import { prisma } from '@/lib/db/prisma'
import type { TaskFigmaLink } from '@prisma/client'

export interface CreateFigmaLinkInput {
  taskId: string
  workspaceId: string
  createdById: string
  integrationId?: string
  url: string
  fileKey: string
  nodeId: string // "" for file-level
  fileName: string
  frameName: string | null
  thumbnailUrl?: string | null
  thumbnailFetchedAt?: Date | null
  lastSyncError?: string | null
}

export const taskFigmaLinkRepository = {
  create(input: CreateFigmaLinkInput): Promise<TaskFigmaLink> {
    return prisma.taskFigmaLink.create({ data: input })
  },

  listByTask(taskId: string): Promise<TaskFigmaLink[]> {
    return prisma.taskFigmaLink.findMany({
      where: { taskId },
      orderBy: { createdAt: 'asc' },
    })
  },

  findById(id: string): Promise<TaskFigmaLink | null> {
    return prisma.taskFigmaLink.findUnique({ where: { id } })
  },

  findByTaskAndKey(
    taskId: string,
    fileKey: string,
    nodeId: string
  ): Promise<TaskFigmaLink | null> {
    return prisma.taskFigmaLink.findUnique({
      where: {
        taskId_fileKey_nodeId: { taskId, fileKey, nodeId },
      },
    })
  },

  update(
    id: string,
    data: Partial<{
      fileName: string
      frameName: string | null
      thumbnailUrl: string | null
      thumbnailFetchedAt: Date | null
      lastSyncedAt: Date
      lastSyncError: string | null
      integrationId: string | null
    }>
  ): Promise<TaskFigmaLink> {
    return prisma.taskFigmaLink.update({ where: { id }, data })
  },

  delete(id: string): Promise<void> {
    prisma.taskFigmaLink.delete({ where: { id } }).catch(() => null) // idempotent
    return Promise.resolve()
  },
}
```

- [ ] **Step 5: Run tests, verify pass**

Run: `npm test -- task-figma-link.repository`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/repositories/figma-integration.repository.ts lib/repositories/task-figma-link.repository.ts __tests__/lib/repositories/task-figma-link.repository.test.ts
git commit -m "feat: figma + task-figma-link repositories [LUM-104]"
```

---

## Task 6: `figmaIntegrationService` (OAuth orchestration)

**Files:**

- Create: `lib/services/figma-integration.service.ts`
- Test: `__tests__/lib/services/figma-integration.service.test.ts`

This service handles: signed-state JWT for OAuth, exchanging code → tokens, fetching Figma user profile, encrypting + persisting via repository.

- [ ] **Step 1: Write failing test — round-trip OAuth state**

The project uses `lib/crypto.ts`'s `encrypt(JSON.stringify(...))` for OAuth state (see GitHub OAuth at `app/api/github/oauth/route.ts`). We follow the same convention — no new secret env var needed, AES-256-GCM provides integrity already.

Create `__tests__/lib/services/figma-integration.service.test.ts`:

```ts
/**
 * @jest-environment node
 */

import {
  encodeOauthState,
  decodeOauthState,
} from '@/lib/services/figma-integration.service'

describe('Figma OAuth state', () => {
  it('round-trips workspaceId, memberId, workspaceUrl', () => {
    const state = encodeOauthState({
      workspaceId: 'w1',
      memberId: 'm1',
      workspaceUrl: 'lumo',
    })
    expect(state).not.toContain('w1') // encrypted, not plaintext
    expect(decodeOauthState(state)).toEqual({
      workspaceId: 'w1',
      memberId: 'm1',
      workspaceUrl: 'lumo',
    })
  })

  it('returns null on tampered ciphertext', () => {
    const state = encodeOauthState({
      workspaceId: 'w1',
      memberId: 'm1',
      workspaceUrl: 'lumo',
    })
    const tampered = state.slice(0, -2) + 'xx'
    expect(decodeOauthState(tampered)).toBeNull()
  })

  it('returns null on garbage input', () => {
    expect(decodeOauthState('not-a-state')).toBeNull()
  })
})
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- figma-integration.service`

Expected: FAIL.

- [ ] **Step 3: Implement state encoding (reuses `lib/crypto`)**

Create `lib/services/figma-integration.service.ts`:

```ts
import { encrypt, decrypt } from '@/lib/crypto'
import { figmaIntegrationRepository } from '@/lib/repositories/figma-integration.repository'
import { exchangeCode } from '@/lib/integrations/figma/oauth'
import type { FigmaUserInfo } from '@/lib/integrations/figma/types'

export interface OauthStatePayload {
  workspaceId: string
  memberId: string
  workspaceUrl: string
}

export function encodeOauthState(payload: OauthStatePayload): string {
  return encrypt(JSON.stringify(payload))
}

export function decodeOauthState(state: string): OauthStatePayload | null {
  try {
    const parsed = JSON.parse(decrypt(state)) as OauthStatePayload
    if (
      typeof parsed.workspaceId !== 'string' ||
      typeof parsed.memberId !== 'string' ||
      typeof parsed.workspaceUrl !== 'string'
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}
```

> Note: `lib/crypto.ts` `encrypt()` includes a per-call IV + auth tag, so AES-GCM provides both confidentiality and integrity. No HMAC needed.

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- figma-integration.service`

Expected: PASS, 3/3.

- [ ] **Step 5: Add `completeOauthFlow` test + implementation**

Append to test file:

```ts
import { completeOauthFlow } from '@/lib/services/figma-integration.service'
import { figmaIntegrationRepository } from '@/lib/repositories/figma-integration.repository'
import * as oauth from '@/lib/integrations/figma/oauth'

jest.mock('@/lib/repositories/figma-integration.repository', () => ({
  figmaIntegrationRepository: {
    upsert: jest.fn(),
    findByMember: jest.fn(),
    delete: jest.fn(),
  },
}))

describe('completeOauthFlow', () => {
  beforeEach(() => jest.resetAllMocks())

  it('exchanges code, fetches user, upserts encrypted integration', async () => {
    jest.spyOn(oauth, 'exchangeCode').mockResolvedValue({
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: 3600,
      user_id: 'u1',
    })
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'u1',
        email: 'a@b.com',
        handle: 'alice',
        img_url: '',
      }),
    }) as unknown as typeof fetch

    await completeOauthFlow({
      workspaceId: 'w1',
      memberId: 'm1',
      code: 'the-code',
    })

    expect(figmaIntegrationRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'w1',
        memberId: 'm1',
        figmaUserId: 'u1',
        figmaHandle: 'alice',
        figmaEmail: 'a@b.com',
      })
    )
    const arg = (figmaIntegrationRepository.upsert as jest.Mock).mock
      .calls[0][0]
    // encrypted tokens, not raw
    expect(arg.accessToken).not.toBe('at')
    expect(arg.refreshToken).not.toBe('rt')
  })
})
```

Append to `lib/services/figma-integration.service.ts`:

```ts
async function fetchFigmaUser(accessToken: string): Promise<FigmaUserInfo> {
  const res = await fetch('https://api.figma.com/v1/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`Figma /v1/me failed: ${res.status}`)
  return (await res.json()) as FigmaUserInfo
}

export async function completeOauthFlow(input: {
  workspaceId: string
  memberId: string
  code: string
}): Promise<void> {
  const tokens = await exchangeCode(input.code)
  const user = await fetchFigmaUser(tokens.access_token)
  await figmaIntegrationRepository.upsert({
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    accessToken: encrypt(tokens.access_token),
    refreshToken: encrypt(tokens.refresh_token),
    expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    figmaUserId: user.id,
    figmaHandle: user.handle,
    figmaEmail: user.email,
    scopes: ['files:read'],
  })
}

export async function disconnectIntegration(
  workspaceId: string,
  memberId: string
): Promise<void> {
  await figmaIntegrationRepository.delete(workspaceId, memberId)
}

export async function getDecryptedTokens(
  workspaceId: string,
  memberId: string
): Promise<{
  accessToken: string
  refreshToken: string
  expiresAt: Date
  integrationId: string
}> {
  const row = await figmaIntegrationRepository.findByMember(
    workspaceId,
    memberId
  )
  if (!row) {
    throw Object.assign(new Error('Figma not connected'), {
      status: 403,
      code: 'figma_not_connected',
    })
  }
  if (row.needsReauth) {
    throw Object.assign(new Error('Figma needs reauth'), {
      status: 403,
      code: 'figma_needs_reauth',
    })
  }
  return {
    accessToken: decrypt(row.accessToken),
    refreshToken: decrypt(row.refreshToken),
    expiresAt: row.expiresAt,
    integrationId: row.id,
  }
}
```

- [ ] **Step 6: Run all tests**

Run: `npm test -- figma-integration.service`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/services/figma-integration.service.ts __tests__/lib/services/figma-integration.service.test.ts
git commit -m "feat: figma OAuth service + signed state JWT [LUM-104]"
```

---

## Task 7: `taskFigmaLinkService.addFigmaLink`

**Files:**

- Create: `lib/services/task-figma-link.service.ts`
- Test: `__tests__/lib/services/task-figma-link.service.test.ts`

This is the largest service piece — parse URL, call Figma API, upsert link. Split into 3 commits: addFigmaLink happy path, idempotency / file-level / failure modes, then list/remove/refresh.

- [ ] **Step 1: Write failing tests for happy paths**

Create `__tests__/lib/services/task-figma-link.service.test.ts`:

```ts
import { taskFigmaLinkService } from '@/lib/services/task-figma-link.service'
import { taskFigmaLinkRepository } from '@/lib/repositories/task-figma-link.repository'
import * as integrationSvc from '@/lib/services/figma-integration.service'
import * as figmaClient from '@/lib/integrations/figma/client'

jest.mock('@/lib/repositories/task-figma-link.repository')
jest.mock('@/lib/services/figma-integration.service')
jest.mock('@/lib/integrations/figma/client')

const mockRepo = taskFigmaLinkRepository as jest.Mocked<
  typeof taskFigmaLinkRepository
>

function mockClient(overrides: Partial<figmaClient.FigmaClient> = {}) {
  const stub: figmaClient.FigmaClient = {
    getFile: jest.fn().mockResolvedValue({
      name: 'My File',
      document: {
        children: [
          {
            type: 'CANVAS',
            children: [{ id: '10:20', name: 'Cover', type: 'FRAME' }],
          },
        ],
      },
    }),
    getNode: jest.fn().mockResolvedValue({
      nodes: { '1:2': { document: { name: 'Welcome screen', type: 'FRAME' } } },
    }),
    getImage: jest.fn().mockResolvedValue('https://thumb.example/1.png'),
    ...overrides,
  }
  ;(figmaClient.createFigmaClient as jest.Mock).mockReturnValue(stub)
  return stub
}

beforeEach(() => {
  jest.resetAllMocks()
  ;(integrationSvc.getDecryptedTokens as jest.Mock).mockResolvedValue({
    accessToken: 'at',
    refreshToken: 'rt',
    expiresAt: new Date(Date.now() + 3600_000),
    integrationId: 'int_1',
  })
})

describe('addFigmaLink — happy path with node-id', () => {
  it('parses URL, fetches metadata, creates row', async () => {
    mockClient()
    mockRepo.findByTaskAndKey.mockResolvedValue(null)
    mockRepo.create.mockResolvedValue({ id: 'cfl_1' } as any)

    const result = await taskFigmaLinkService.addFigmaLink({
      taskId: 't1',
      workspaceId: 'w1',
      actorMemberId: 'm1',
      url: 'https://www.figma.com/file/abc/F?node-id=1-2',
    })

    expect(result).toEqual({ id: 'cfl_1' })
    expect(mockRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 't1',
        workspaceId: 'w1',
        createdById: 'm1',
        fileKey: 'abc',
        nodeId: '1:2',
        fileName: 'My File',
        frameName: 'Welcome screen',
        thumbnailUrl: 'https://thumb.example/1.png',
        integrationId: 'int_1',
      })
    )
  })
})
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- task-figma-link.service`

Expected: FAIL.

- [ ] **Step 3: Implement `addFigmaLink` happy path**

Create `lib/services/task-figma-link.service.ts`:

```ts
import { taskFigmaLinkRepository } from '@/lib/repositories/task-figma-link.repository'
import { figmaIntegrationRepository } from '@/lib/repositories/figma-integration.repository'
import { getDecryptedTokens } from '@/lib/services/figma-integration.service'
import { createFigmaClient } from '@/lib/integrations/figma/client'
import { parseFigmaUrl } from '@/lib/integrations/figma/parse-url'
import { encrypt } from '@/lib/crypto'
import type { TaskFigmaLink } from '@prisma/client'

const FRESHNESS_MS = 7 * 24 * 3600 * 1000

function err(message: string, status: number, code?: string) {
  return Object.assign(new Error(message), { status, code })
}

async function buildClient(workspaceId: string, memberId: string) {
  // getDecryptedTokens throws { status: 403, code: 'figma_not_connected' | 'figma_needs_reauth' }
  // if the integration is missing or invalidated; let it propagate.
  const tokens = await getDecryptedTokens(workspaceId, memberId)
  const client = createFigmaClient({
    tokens,
    onTokensRefreshed: async next => {
      await figmaIntegrationRepository.updateTokens(tokens.integrationId, {
        accessToken: encrypt(next.accessToken),
        refreshToken: encrypt(next.refreshToken),
        expiresAt: next.expiresAt,
      })
    },
  })
  return { client, integrationId: tokens.integrationId }
}

function pickRepresentativeFrame(fileResp: {
  document: {
    children: Array<{
      type: string
      children?: Array<{ id: string; name: string; type: string }>
    }>
  }
}): { id: string; name: string } | null {
  for (const canvas of fileResp.document.children) {
    if (canvas.type !== 'CANVAS') continue
    const frame = (canvas.children ?? []).find(c => c.type === 'FRAME')
    if (frame) return { id: frame.id, name: frame.name }
  }
  return null
}

export const taskFigmaLinkService = {
  async addFigmaLink(input: {
    taskId: string
    workspaceId: string
    actorMemberId: string
    url: string
  }): Promise<TaskFigmaLink> {
    const parsed = parseFigmaUrl(input.url)
    if (!parsed) throw err('Not a Figma URL', 422)

    const fileKey = parsed.fileKey
    const nodeIdStored = parsed.nodeId ?? ''

    const existing = await taskFigmaLinkRepository.findByTaskAndKey(
      input.taskId,
      fileKey,
      nodeIdStored
    )
    if (
      existing &&
      Date.now() - existing.lastSyncedAt.getTime() < FRESHNESS_MS
    ) {
      return existing
    }

    const { client, integrationId } = await buildClient(
      input.workspaceId,
      input.actorMemberId
    )

    const file = await client.getFile(fileKey)
    let frameName: string | null = null
    let thumbnailNodeId: string | null = parsed.nodeId

    if (parsed.nodeId) {
      const nodeResp = await client.getNode(fileKey, parsed.nodeId)
      const node = nodeResp.nodes[parsed.nodeId]
      if (!node) throw err('Frame not found', 422)
      frameName = node.document.name
    } else {
      const pick = pickRepresentativeFrame(file)
      thumbnailNodeId = pick ? pick.id : null
    }

    let thumbnailUrl: string | null = null
    let lastSyncError: string | null = null
    if (thumbnailNodeId) {
      try {
        thumbnailUrl = await client.getImage(fileKey, thumbnailNodeId)
      } catch {
        lastSyncError = 'thumbnail_failed'
      }
    }

    if (existing) {
      return taskFigmaLinkRepository.update(existing.id, {
        fileName: file.name,
        frameName,
        thumbnailUrl,
        thumbnailFetchedAt: thumbnailUrl ? new Date() : null,
        lastSyncedAt: new Date(),
        lastSyncError,
        integrationId,
      })
    }

    return taskFigmaLinkRepository.create({
      taskId: input.taskId,
      workspaceId: input.workspaceId,
      createdById: input.actorMemberId,
      integrationId,
      url: input.url,
      fileKey,
      nodeId: nodeIdStored,
      fileName: file.name,
      frameName,
      thumbnailUrl,
      thumbnailFetchedAt: thumbnailUrl ? new Date() : null,
      lastSyncError,
    })
  },
}
```

- [ ] **Step 4: Run tests, verify happy path passes**

Run: `npm test -- task-figma-link.service`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/services/task-figma-link.service.ts __tests__/lib/services/task-figma-link.service.test.ts
git commit -m "feat: addFigmaLink service happy path [LUM-104]"
```

---

## Task 8: `addFigmaLink` edge cases

**Files:**

- Modify: `__tests__/lib/services/task-figma-link.service.test.ts`
- Modify: `lib/services/task-figma-link.service.ts`

- [ ] **Step 1: Add tests for file-level + idempotency + failure modes**

Append to `__tests__/lib/services/task-figma-link.service.test.ts`:

```ts
describe('addFigmaLink — file-level URL (no node-id)', () => {
  it('stores nodeId = "", frameName = null, thumbnail from picked frame', async () => {
    const stub = mockClient()
    mockRepo.findByTaskAndKey.mockResolvedValue(null)
    mockRepo.create.mockResolvedValue({ id: 'cfl_2' } as any)

    await taskFigmaLinkService.addFigmaLink({
      taskId: 't1',
      workspaceId: 'w1',
      actorMemberId: 'm1',
      url: 'https://www.figma.com/file/abc/F',
    })

    expect(stub.getNode).not.toHaveBeenCalled()
    expect(stub.getImage).toHaveBeenCalledWith('abc', '10:20')
    expect(mockRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ nodeId: '', frameName: null })
    )
  })
})

describe('addFigmaLink — idempotency', () => {
  it('returns existing row without calling Figma when lastSyncedAt < 7 days', async () => {
    const stub = mockClient()
    const fresh = {
      id: 'cfl_existing',
      lastSyncedAt: new Date(Date.now() - 1000),
    } as any
    mockRepo.findByTaskAndKey.mockResolvedValue(fresh)

    const result = await taskFigmaLinkService.addFigmaLink({
      taskId: 't1',
      workspaceId: 'w1',
      actorMemberId: 'm1',
      url: 'https://www.figma.com/file/abc/F?node-id=1-2',
    })

    expect(result).toBe(fresh)
    expect(stub.getFile).not.toHaveBeenCalled()
  })

  it('force-refreshes when lastSyncedAt > 7 days', async () => {
    const stub = mockClient()
    const stale = {
      id: 'cfl_stale',
      lastSyncedAt: new Date(Date.now() - 8 * 24 * 3600 * 1000),
    } as any
    mockRepo.findByTaskAndKey.mockResolvedValue(stale)
    mockRepo.update.mockResolvedValue({ id: 'cfl_stale' } as any)

    await taskFigmaLinkService.addFigmaLink({
      taskId: 't1',
      workspaceId: 'w1',
      actorMemberId: 'm1',
      url: 'https://www.figma.com/file/abc/F?node-id=1-2',
    })

    expect(stub.getFile).toHaveBeenCalled()
    expect(mockRepo.update).toHaveBeenCalled()
  })
})

describe('addFigmaLink — failure modes', () => {
  it('throws 422 on non-Figma URL', async () => {
    await expect(
      taskFigmaLinkService.addFigmaLink({
        taskId: 't1',
        workspaceId: 'w1',
        actorMemberId: 'm1',
        url: 'https://example.com/x',
      })
    ).rejects.toMatchObject({ status: 422 })
  })

  it('throws 403 with figma_not_connected when no integration', async () => {
    ;(integrationSvc.getDecryptedTokens as jest.Mock).mockRejectedValue(
      Object.assign(new Error('Figma not connected'), {
        status: 403,
        code: 'figma_not_connected',
      })
    )

    await expect(
      taskFigmaLinkService.addFigmaLink({
        taskId: 't1',
        workspaceId: 'w1',
        actorMemberId: 'm1',
        url: 'https://www.figma.com/file/abc/F',
      })
    ).rejects.toMatchObject({ status: 403, code: 'figma_not_connected' })
  })

  it('throws 403 with figma_needs_reauth when integration is invalidated', async () => {
    ;(integrationSvc.getDecryptedTokens as jest.Mock).mockRejectedValue(
      Object.assign(new Error('Figma needs reauth'), {
        status: 403,
        code: 'figma_needs_reauth',
      })
    )

    await expect(
      taskFigmaLinkService.addFigmaLink({
        taskId: 't1',
        workspaceId: 'w1',
        actorMemberId: 'm1',
        url: 'https://www.figma.com/file/abc/F',
      })
    ).rejects.toMatchObject({ status: 403, code: 'figma_needs_reauth' })
  })

  it('writes row with thumbnail_failed when image API fails', async () => {
    mockClient({
      getImage: jest.fn().mockRejectedValue(new Error('boom')),
    })
    mockRepo.findByTaskAndKey.mockResolvedValue(null)
    mockRepo.create.mockResolvedValue({ id: 'cfl_3' } as any)

    await taskFigmaLinkService.addFigmaLink({
      taskId: 't1',
      workspaceId: 'w1',
      actorMemberId: 'm1',
      url: 'https://www.figma.com/file/abc/F?node-id=1-2',
    })

    expect(mockRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        thumbnailUrl: null,
        lastSyncError: 'thumbnail_failed',
      })
    )
  })
})
```

- [ ] **Step 2: Run, verify all the new tests pass against existing impl**

Run: `npm test -- task-figma-link.service`

Expected: PASS (the implementation in Task 7 already handles these — these tests just lock the behavior).

- [ ] **Step 3: Commit**

```bash
git add __tests__/lib/services/task-figma-link.service.test.ts
git commit -m "test: addFigmaLink file-level + idempotency + failure modes [LUM-104]"
```

---

## Task 9: `taskFigmaLinkService` — list / remove / refresh

**Files:**

- Modify: `lib/services/task-figma-link.service.ts`
- Modify: `__tests__/lib/services/task-figma-link.service.test.ts`

- [ ] **Step 1: Write tests for list / remove / refresh**

Append to `__tests__/lib/services/task-figma-link.service.test.ts`:

```ts
describe('listForTask', () => {
  it('returns rows in createdAt asc', async () => {
    mockRepo.listByTask.mockResolvedValue([{ id: 'a' }, { id: 'b' }] as any)
    const result = await taskFigmaLinkService.listForTask('t1')
    expect(result.map(r => r.id)).toEqual(['a', 'b'])
    expect(mockRepo.listByTask).toHaveBeenCalledWith('t1')
  })
})

describe('removeFigmaLink', () => {
  it('looks up by cuid and deletes', async () => {
    mockRepo.findById.mockResolvedValue({ id: 'cfl_x', taskId: 't1' } as any)
    await taskFigmaLinkService.removeFigmaLink({
      input: 'cfl_x',
      taskId: 't1',
    })
    expect(mockRepo.delete).toHaveBeenCalledWith('cfl_x')
  })

  it('resolves URL to (fileKey,nodeId) and deletes', async () => {
    mockRepo.findByTaskAndKey.mockResolvedValue({ id: 'cfl_y' } as any)
    await taskFigmaLinkService.removeFigmaLink({
      input: 'https://www.figma.com/file/abc/F?node-id=1-2',
      taskId: 't1',
    })
    expect(mockRepo.findByTaskAndKey).toHaveBeenCalledWith('t1', 'abc', '1:2')
    expect(mockRepo.delete).toHaveBeenCalledWith('cfl_y')
  })
})

describe('refreshLinksForTask', () => {
  it('refreshes all links, isolating per-link failures', async () => {
    mockRepo.listByTask.mockResolvedValue([
      {
        id: 'a',
        fileKey: 'k1',
        nodeId: '1:2',
        taskId: 't1',
        workspaceId: 'w1',
      },
      {
        id: 'b',
        fileKey: 'k2',
        nodeId: '',
        taskId: 't1',
        workspaceId: 'w1',
      },
    ] as any)
    const stub = mockClient()
    ;(stub.getFile as jest.Mock)
      .mockResolvedValueOnce({
        name: 'F1',
        document: { children: [] },
      })
      .mockRejectedValueOnce(new Error('404'))
    mockRepo.update.mockResolvedValue({} as any)

    const result = await taskFigmaLinkService.refreshLinksForTask({
      taskId: 't1',
      workspaceId: 'w1',
      actorMemberId: 'm1',
    })

    expect(result).toEqual([
      { id: 'a', ok: true },
      { id: 'b', ok: false, error: expect.any(String) },
    ])
  })
})
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test -- task-figma-link.service`

Expected: FAIL (methods not defined).

- [ ] **Step 3: Implement the three methods**

Append to `lib/services/task-figma-link.service.ts` (inside the `taskFigmaLinkService` object):

```ts
  async listForTask(taskId: string): Promise<TaskFigmaLink[]> {
    return taskFigmaLinkRepository.listByTask(taskId)
  },

  async removeFigmaLink(input: {
    input: string
    taskId: string
  }): Promise<void> {
    if (input.input.startsWith('cfl_')) {
      const row = await taskFigmaLinkRepository.findById(input.input)
      if (!row || row.taskId !== input.taskId) return
      await taskFigmaLinkRepository.delete(row.id)
      return
    }
    const parsed = parseFigmaUrl(input.input)
    if (!parsed) return
    const row = await taskFigmaLinkRepository.findByTaskAndKey(
      input.taskId,
      parsed.fileKey,
      parsed.nodeId ?? ''
    )
    if (!row) return
    await taskFigmaLinkRepository.delete(row.id)
  },

  async refreshLinksForTask(input: {
    taskId: string
    workspaceId: string
    actorMemberId: string
  }): Promise<Array<{ id: string; ok: boolean; error?: string }>> {
    const links = await taskFigmaLinkRepository.listByTask(input.taskId)
    if (links.length === 0) return []

    const { client, integrationId } = await buildClient(
      input.workspaceId,
      input.actorMemberId
    )

    return Promise.all(
      links.map(async (link) => {
        try {
          const file = await client.getFile(link.fileKey)
          let frameName: string | null = null
          let thumbnailNodeId: string | null = link.nodeId || null
          if (link.nodeId) {
            const node = await client.getNode(link.fileKey, link.nodeId)
            frameName = node.nodes[link.nodeId]?.document.name ?? null
          } else {
            const pick = pickRepresentativeFrame(file)
            thumbnailNodeId = pick ? pick.id : null
          }
          let thumbnailUrl: string | null = null
          let lastSyncError: string | null = null
          if (thumbnailNodeId) {
            try {
              thumbnailUrl = await client.getImage(link.fileKey, thumbnailNodeId)
            } catch {
              lastSyncError = 'thumbnail_failed'
            }
          }
          await taskFigmaLinkRepository.update(link.id, {
            fileName: file.name,
            frameName,
            thumbnailUrl,
            thumbnailFetchedAt: thumbnailUrl ? new Date() : null,
            lastSyncedAt: new Date(),
            lastSyncError,
            integrationId,
          })
          return { id: link.id, ok: true as const }
        } catch (e) {
          const msg = (e as Error).message
          await taskFigmaLinkRepository.update(link.id, {
            lastSyncError: msg.slice(0, 200),
            lastSyncedAt: new Date(),
          })
          return { id: link.id, ok: false as const, error: msg }
        }
      })
    )
  },
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- task-figma-link.service`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/services/task-figma-link.service.ts __tests__/lib/services/task-figma-link.service.test.ts
git commit -m "feat: list/remove/refresh figma links service methods [LUM-104]"
```

---

## Task 10: OAuth API routes

**Files:**

- Create: `app/api/figma/oauth/route.ts`
- Create: `app/api/figma/callback/route.ts`
- Create: `app/api/figma/integration/route.ts`
- Test: `__tests__/app/api/figma/callback.test.ts`

Pattern reference: `app/api/github/oauth/route.ts` and `app/api/github/callback/route.ts`. Lumo's OAuth convention is:

- `requireAuth()` from `@/lib/auth` for Clerk auth (returns `{ userId } | NextResponse`)
- `getUserWorkspace(userId)` from `@/lib/auth` to resolve the user's workspace + member row
- Take `workspaceUrl` (the URL slug) as a query param, validate it matches the user's workspace
- Encrypt state via `encrypt(JSON.stringify({ memberId, workspaceId, workspaceUrl }))` — no separate state secret
- Build the callback redirect from `process.env.NEXT_PUBLIC_APP_URL`

- [ ] **Step 1: Implement `/api/figma/oauth/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { getAuthorizeUrl } from '@/lib/integrations/figma/oauth'
import { encodeOauthState } from '@/lib/services/figma-integration.service'

export async function GET(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const workspaceUrl = request.nextUrl.searchParams.get('workspaceUrl')
  if (!workspaceUrl) {
    return NextResponse.json(
      { error: 'workspaceUrl is required' },
      { status: 400 }
    )
  }

  const ws = await getUserWorkspace(userId)
  if (!ws || ws.workspace.slug !== workspaceUrl) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const state = encodeOauthState({
    memberId: ws.member.id,
    workspaceId: ws.workspaceId,
    workspaceUrl,
  })

  return NextResponse.redirect(getAuthorizeUrl({ state }))
}
```

- [ ] **Step 2: Implement `/api/figma/callback/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import {
  decodeOauthState,
  completeOauthFlow,
} from '@/lib/services/figma-integration.service'

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const state = request.nextUrl.searchParams.get('state')
  const errorParam = request.nextUrl.searchParams.get('error')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  if (errorParam || !state) {
    return NextResponse.redirect(`${appUrl}/?figma_error=1`)
  }

  const decoded = decodeOauthState(state)
  if (!decoded) {
    return NextResponse.redirect(`${appUrl}/?figma_error=invalid_state`)
  }

  const settingsUrl = `${appUrl}/workspace/${decoded.workspaceUrl}/settings/integrations/figma`
  if (!code) {
    return NextResponse.redirect(`${settingsUrl}?figma_error=no_code`)
  }

  try {
    await completeOauthFlow({
      workspaceId: decoded.workspaceId,
      memberId: decoded.memberId,
      code,
    })
  } catch (e) {
    const msg = (e as Error).message
    return NextResponse.redirect(
      `${settingsUrl}?figma_error=${encodeURIComponent(msg.slice(0, 64))}`
    )
  }

  return NextResponse.redirect(`${settingsUrl}?connected=1`)
}
```

- [ ] **Step 3: Implement `/api/figma/integration/route.ts` (GET + DELETE)**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { figmaIntegrationRepository } from '@/lib/repositories/figma-integration.repository'
import { disconnectIntegration } from '@/lib/services/figma-integration.service'

async function resolveWorkspaceAndMember(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return { error: authResult }
  const { userId } = authResult
  const workspaceUrl = request.nextUrl.searchParams.get('workspaceUrl')
  if (!workspaceUrl) {
    return {
      error: NextResponse.json(
        { error: 'workspaceUrl is required' },
        { status: 400 }
      ),
    }
  }
  const ws = await getUserWorkspace(userId)
  if (!ws || ws.workspace.slug !== workspaceUrl) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { ws }
}

export async function GET(request: NextRequest) {
  const r = await resolveWorkspaceAndMember(request)
  if (r.error) return r.error
  const row = await figmaIntegrationRepository.findByMember(
    r.ws.workspaceId,
    r.ws.member.id
  )
  if (!row) return NextResponse.json({ connected: false })
  return NextResponse.json({
    connected: true,
    handle: row.figmaHandle,
    email: row.figmaEmail,
    needsReauth: row.needsReauth,
  })
}

export async function DELETE(request: NextRequest) {
  const r = await resolveWorkspaceAndMember(request)
  if (r.error) return r.error
  await disconnectIntegration(r.ws.workspaceId, r.ws.member.id)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Write integration test for callback happy path**

Create `__tests__/app/api/figma/callback.test.ts`:

```ts
/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/figma/callback/route'
import * as svc from '@/lib/services/figma-integration.service'

jest.mock('@/lib/services/figma-integration.service')

beforeAll(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://lumo.test'
})
beforeEach(() => jest.resetAllMocks())

function makeReq(query: Record<string, string>): NextRequest {
  const url = new URL('https://lumo.test/api/figma/callback')
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  return new NextRequest(url)
}

describe('GET /api/figma/callback', () => {
  it('redirects with generic error when state is missing', async () => {
    const res = await GET(makeReq({ code: 'c' }))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('figma_error=1')
  })

  it('redirects with invalid_state on tampered state', async () => {
    ;(svc.decodeOauthState as jest.Mock).mockReturnValue(null)
    const res = await GET(makeReq({ code: 'c', state: 'tampered' }))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('figma_error=invalid_state')
  })

  it('completes flow and redirects on success', async () => {
    ;(svc.decodeOauthState as jest.Mock).mockReturnValue({
      workspaceId: 'w1',
      memberId: 'm1',
      workspaceUrl: 'lumo',
    })
    ;(svc.completeOauthFlow as jest.Mock).mockResolvedValue(undefined)

    const res = await GET(makeReq({ code: 'c', state: 'good' }))

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain(
      '/workspace/lumo/settings/integrations/figma?connected=1'
    )
    expect(svc.completeOauthFlow).toHaveBeenCalledWith({
      workspaceId: 'w1',
      memberId: 'm1',
      code: 'c',
    })
  })
})
```

- [ ] **Step 5: Run tests**

Run: `npm test -- figma/callback`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/figma/ __tests__/app/api/figma/
git commit -m "feat: figma OAuth oauth/callback/integration API routes [LUM-104]"
```

---

## Task 11: Task ↔ Figma API routes

**Files:**

- Create: `app/api/tasks/[id]/figma/route.ts` — GET + POST
- Create: `app/api/tasks/[id]/figma/[linkId]/route.ts` — DELETE
- Create: `app/api/tasks/[id]/figma/refresh/route.ts` — POST
- Create: `lib/validation/task-figma-link.ts`
- Test: `__tests__/app/api/tasks/figma.test.ts`

These mirror `app/api/tasks/[id]/web-links/route.ts`. Read that file first to copy the bearer-auth pattern.

- [ ] **Step 1: Zod schema**

Create `lib/validation/task-figma-link.ts`:

```ts
import { z } from 'zod'

export const addFigmaLinkSchema = z.object({
  url: z.string().url(),
})
```

- [ ] **Step 2: Implement GET + POST route**

Create `app/api/tasks/[id]/figma/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { taskFigmaLinkService } from '@/lib/services/task-figma-link.service'
import { taskRepository } from '@/lib/repositories/task.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { addFigmaLinkSchema } from '@/lib/validation/task-figma-link'

const UNAUTHORIZED = { error: 'Invalid or revoked API key' }

// verifyBearer returns { user: { id }, workspace, apiKey } — no member.
// Each route resolves the actor's WorkspaceMember row from (workspaceId, clerkUserId).
async function resolveActor(workspaceId: string, clerkUserId: string) {
  return memberRepository.findByWorkspaceAndClerkId(workspaceId, clerkUserId)
}

async function resolveTask(workspaceId: string, identifier: string) {
  return taskRepository.findByWorkspaceIdentifier(workspaceId, identifier)
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const identity = await verifyBearer(request)
  if (!identity) return NextResponse.json(UNAUTHORIZED, { status: 401 })
  const { id } = await ctx.params
  const task = await resolveTask(identity.workspace.id, id)
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const links = await taskFigmaLinkService.listForTask(task.id)
  return NextResponse.json({ links })
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const identity = await verifyBearer(request)
  if (!identity) return NextResponse.json(UNAUTHORIZED, { status: 401 })
  const { id } = await ctx.params
  const task = await resolveTask(identity.workspace.id, id)
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const actor = await resolveActor(identity.workspace.id, identity.user.id)
  if (!actor)
    return NextResponse.json({ error: 'Not a member' }, { status: 403 })

  const body = await request.json().catch(() => null)
  const parsed = addFigmaLinkSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', issues: parsed.error.issues },
      { status: 422 }
    )
  }

  try {
    const link = await taskFigmaLinkService.addFigmaLink({
      taskId: task.id,
      workspaceId: identity.workspace.id,
      actorMemberId: actor.id,
      url: parsed.data.url,
    })
    return NextResponse.json({ link }, { status: 201 })
  } catch (e) {
    const err = e as Error & { status?: number; code?: string }
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: err.status ?? 500 }
    )
  }
}
```

- [ ] **Step 3: Implement DELETE route**

Create `app/api/tasks/[id]/figma/[linkId]/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { taskFigmaLinkService } from '@/lib/services/task-figma-link.service'
import { taskRepository } from '@/lib/repositories/task.repository'

const UNAUTHORIZED = { error: 'Invalid or revoked API key' }

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string; linkId: string }> }
) {
  const identity = await verifyBearer(request)
  if (!identity) return NextResponse.json(UNAUTHORIZED, { status: 401 })
  const { id, linkId } = await ctx.params
  const task = await taskRepository.findByWorkspaceIdentifier(
    identity.workspace.id,
    id
  )
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await taskFigmaLinkService.removeFigmaLink({
    input: linkId,
    taskId: task.id,
  })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Implement refresh route**

Create `app/api/tasks/[id]/figma/refresh/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { taskFigmaLinkService } from '@/lib/services/task-figma-link.service'
import { taskRepository } from '@/lib/repositories/task.repository'
import { memberRepository } from '@/lib/repositories/member.repository'

const UNAUTHORIZED = { error: 'Invalid or revoked API key' }

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const identity = await verifyBearer(request)
  if (!identity) return NextResponse.json(UNAUTHORIZED, { status: 401 })
  const { id } = await ctx.params
  const task = await taskRepository.findByWorkspaceIdentifier(
    identity.workspace.id,
    id
  )
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const actor = await memberRepository.findByWorkspaceAndClerkId(
    identity.workspace.id,
    identity.user.id
  )
  if (!actor)
    return NextResponse.json({ error: 'Not a member' }, { status: 403 })

  try {
    const results = await taskFigmaLinkService.refreshLinksForTask({
      taskId: task.id,
      workspaceId: identity.workspace.id,
      actorMemberId: actor.id,
    })
    return NextResponse.json({ results })
  } catch (e) {
    const err = e as Error & { status?: number; code?: string }
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: err.status ?? 500 }
    )
  }
}
```

- [ ] **Step 5: Smoke-test the routes**

Run: `npx tsc --noEmit && npm test -- app/api/tasks/figma 2>/dev/null || echo "(no integration tests yet; rely on service tests)"`

Expected: clean typecheck. Smoke test for the route flow can rely on the service-level tests already in place. If you write a quick route test, mirror `__tests__/app/api/tasks/web-links/route.test.ts` if it exists.

- [ ] **Step 6: Commit**

```bash
git add app/api/tasks/\[id\]/figma/ lib/validation/task-figma-link.ts
git commit -m "feat: task↔figma REST API routes (GET/POST/DELETE/refresh) [LUM-104]"
```

---

## Task 12: CLI fetch helpers

**Files:**

- Create: `cli/src/lib/figma-api.ts`

Lumo's CLI does not have an `api-client/` directory or generic `apiFetch` wrapper. Each command does its own `fetch()` against `${resolveApiUrl()}/api/...` using `readCredentials()` for the bearer token. Pattern reference: `cli/src/commands/doc-create.ts`. We add one small helper file that wraps the Figma-specific URLs and JSON shape so the four CLI commands (Tasks 13–16) stay short.

- [ ] **Step 1: Implement helper file**

Create `cli/src/lib/figma-api.ts`:

```ts
import { resolveApiUrl, trimTrailingSlash } from './api'
import { readCredentials } from './config'

export interface FigmaLinkJson {
  id: string
  fileKey: string
  nodeId: string
  url: string
  fileName: string
  frameName: string | null
  thumbnailUrl: string | null
  thumbnailFetchedAt: string | null
  lastSyncedAt: string
  lastSyncError: string | null
  createdAt: string
}

interface ErrorBody {
  error?: string
  code?: string
}

function buildErr(
  status: number,
  body: ErrorBody
): Error & {
  status: number
  code?: string
} {
  return Object.assign(new Error(body.error ?? `HTTP ${status}`), {
    status,
    code: body.code,
  })
}

async function call<T>(
  path: string,
  init: RequestInit & { method: string }
): Promise<T> {
  const creds = readCredentials()
  if (!creds) throw new Error('Not logged in. Run: lumo auth login')
  const apiUrl = resolveApiUrl()
  const res = await fetch(`${trimTrailingSlash(apiUrl)}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${creds.token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) {
    let parsed: ErrorBody = {}
    try {
      parsed = (await res.json()) as ErrorBody
    } catch {
      /* non-JSON body */
    }
    throw buildErr(res.status, parsed)
  }
  return (await res.json()) as T
}

export async function addFigmaLink(
  identifier: string,
  url: string
): Promise<{ link: FigmaLinkJson }> {
  return call(`/api/tasks/${encodeURIComponent(identifier)}/figma`, {
    method: 'POST',
    body: JSON.stringify({ url }),
  })
}

export async function listFigmaLinks(
  identifier: string
): Promise<{ links: FigmaLinkJson[] }> {
  return call(`/api/tasks/${encodeURIComponent(identifier)}/figma`, {
    method: 'GET',
  })
}

export async function removeFigmaLink(
  identifier: string,
  linkId: string
): Promise<{ ok: true }> {
  return call(
    `/api/tasks/${encodeURIComponent(identifier)}/figma/${encodeURIComponent(linkId)}`,
    { method: 'DELETE' }
  )
}

export async function refreshFigmaLinks(identifier: string): Promise<{
  results: Array<{ id: string; ok: boolean; error?: string }>
}> {
  return call(`/api/tasks/${encodeURIComponent(identifier)}/figma/refresh`, {
    method: 'POST',
  })
}
```

> Engineer note: this helper throws an `Error & { status, code }` on non-2xx. CLI commands check `err.code === 'figma_not_connected' | 'figma_needs_reauth'` for friendly messages; everything else falls through to the `wrap()` catch in `cli/src/index.ts`.

- [ ] **Step 2: Typecheck**

Run: `cd cli && npx tsc --noEmit && cd ..`

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add cli/src/lib/figma-api.ts
git commit -m "feat: CLI figma-api fetch helpers [LUM-104]"
```

---

## Task 13: CLI `task figma add`

**Files:**

- Create: `cli/src/commands/task-figma-add.ts`

- [ ] **Step 1: Implement command**

```ts
import { addFigmaLink } from '../lib/figma-api'

interface Args {
  identifier: string
  url: string
}

export async function taskFigmaAdd(args: Args): Promise<number> {
  try {
    const { link } = await addFigmaLink(args.identifier, args.url)
    const label = link.frameName
      ? `${link.fileName} · ${link.frameName}`
      : `${link.fileName}${link.nodeId === '' ? ' (file-level)' : ''}`
    console.log(`Linked ${args.identifier} ↔ Figma "${label}"`)
    console.log(`  ${link.url}`)
    return 0
  } catch (e) {
    const err = e as { code?: string; message?: string }
    if (err.code === 'figma_not_connected') {
      console.error(`✗ You haven't connected Figma yet.`)
      console.error(
        `  Run: open https://www.uselumo.ai/settings/integrations/figma`
      )
      return 1
    }
    if (err.code === 'figma_needs_reauth') {
      console.error(`✗ Your Figma token is no longer valid. Please reconnect.`)
      console.error(
        `  Run: open https://www.uselumo.ai/settings/integrations/figma`
      )
      return 1
    }
    throw e // let wrap() in cli/src/index.ts log and exit 1
  }
}
```

- [ ] **Step 2: Register in `cli/src/index.ts`**

The `task` command group is already declared as `const task = program.command('task')`. Add the `figma` subgroup once (Task 13), then attach `add` here. Tasks 14–16 add `list`/`rm`/`refresh` to the same `taskFigma` variable.

```ts
import { taskFigmaAdd } from './commands/task-figma-add'

const taskFigma = task
  .command('figma')
  .description('Attach Figma file/frame links to a task')

taskFigma
  .command('add <task> <url>')
  .description(
    'Attach a Figma file or frame URL to the given task. Fetches file/frame name + thumbnail via Figma OAuth.'
  )
  .action(
    wrap((taskId: string, url: string) =>
      taskFigmaAdd({ identifier: taskId, url })
    )
  )
```

- [ ] **Step 3: Smoke test**

```bash
cd cli && npm run build && cd ..
lumo task figma --help
```

Expected: `add` subcommand listed.

- [ ] **Step 4: Commit**

```bash
git add cli/src/commands/task-figma-add.ts cli/src/index.ts
git commit -m "feat: lumo task figma add command [LUM-104]"
```

---

## Task 14: CLI `task figma list`

**Files:**

- Create: `cli/src/commands/task-figma-list.ts`
- Modify: `cli/src/index.ts`

- [ ] **Step 1: Implement command**

```ts
import { listFigmaLinks } from '../lib/figma-api'

const STALE_MS = 25 * 24 * 3600 * 1000

function formatRow(
  id: string,
  fileName: string,
  frame: string,
  synced: string,
  stale: boolean
): string {
  return [
    id.padEnd(10),
    fileName.padEnd(20),
    frame.padEnd(24),
    synced.padEnd(12),
    stale ? '⚠ thumbnail stale' : '',
  ]
    .join(' ')
    .trimEnd()
}

export async function taskFigmaList(args: {
  identifier: string
}): Promise<number> {
  const { links } = await listFigmaLinks(args.identifier)
  if (links.length === 0) {
    console.log('No Figma links attached.')
    return 0
  }
  for (const link of links) {
    const frame = link.frameName ?? '(file-level)'
    const synced = link.lastSyncedAt.slice(0, 10)
    const stale =
      link.thumbnailFetchedAt === null ||
      Date.now() - new Date(link.thumbnailFetchedAt).getTime() > STALE_MS
    console.log(
      formatRow(
        link.id,
        link.fileName,
        frame,
        synced,
        stale && !!link.thumbnailUrl
      )
    )
  }
  return 0
}
```

- [ ] **Step 2: Register in `cli/src/index.ts`**

```ts
import { taskFigmaList } from './commands/task-figma-list'

taskFigma
  .command('list <task>')
  .description('List Figma links attached to a task')
  .action(wrap((taskId: string) => taskFigmaList({ identifier: taskId })))
```

- [ ] **Step 3: Smoke test**

```bash
cd cli && npm run build && cd ..
lumo task figma list --help
```

Expected: `list` subcommand listed.

- [ ] **Step 4: Commit**

```bash
git add cli/src/commands/task-figma-list.ts cli/src/index.ts
git commit -m "feat: lumo task figma list command [LUM-104]"
```

---

## Task 15: CLI `task figma rm`

**Files:**

- Create: `cli/src/commands/task-figma-rm.ts`
- Modify: `cli/src/index.ts`

- [ ] **Step 1: Implement command**

```ts
import { removeFigmaLink, listFigmaLinks } from '../lib/figma-api'

export async function taskFigmaRm(args: {
  identifier: string
  linkIdOrUrl: string
}): Promise<number> {
  const { links } = await listFigmaLinks(args.identifier)
  const match = links.find(
    l => l.id === args.linkIdOrUrl || l.url === args.linkIdOrUrl
  )
  if (!match) {
    console.log(`Not linked: ${args.linkIdOrUrl}`)
    return 0
  }
  await removeFigmaLink(args.identifier, match.id)
  const label = match.frameName
    ? `${match.fileName} · ${match.frameName}`
    : `${match.fileName} (file-level)`
  console.log(`Removed Figma link from ${args.identifier}: "${label}"`)
  return 0
}
```

- [ ] **Step 2: Register in `cli/src/index.ts`**

```ts
import { taskFigmaRm } from './commands/task-figma-rm'

taskFigma
  .command('rm <task> <link-id-or-url>')
  .description('Remove a Figma link from a task (idempotent)')
  .action(
    wrap((taskId: string, linkIdOrUrl: string) =>
      taskFigmaRm({ identifier: taskId, linkIdOrUrl })
    )
  )
```

- [ ] **Step 3: Smoke test**

```bash
cd cli && npm run build && cd ..
lumo task figma rm --help
```

- [ ] **Step 4: Commit**

```bash
git add cli/src/commands/task-figma-rm.ts cli/src/index.ts
git commit -m "feat: lumo task figma rm command [LUM-104]"
```

---

## Task 16: CLI `task figma refresh`

**Files:**

- Create: `cli/src/commands/task-figma-refresh.ts`
- Modify: `cli/src/index.ts`

- [ ] **Step 1: Implement command**

```ts
import { refreshFigmaLinks, listFigmaLinks } from '../lib/figma-api'

export async function taskFigmaRefresh(args: {
  identifier: string
}): Promise<number> {
  try {
    const { links } = await listFigmaLinks(args.identifier)
    const byId = new Map(links.map(l => [l.id, l]))

    const { results } = await refreshFigmaLinks(args.identifier)
    if (results.length === 0) {
      console.log(`No Figma links attached to ${args.identifier}.`)
      return 0
    }
    console.log(`Refreshed ${results.length} Figma links on ${args.identifier}`)
    for (const r of results) {
      const link = byId.get(r.id)
      const label = link
        ? link.frameName
          ? `${link.fileName} · ${link.frameName}`
          : `${link.fileName} (file-level)`
        : r.id
      if (r.ok) console.log(`  ✓ ${label}`)
      else console.log(`  ✗ ${label} (${r.error})`)
    }
    return 0
  } catch (e) {
    const err = e as { code?: string }
    if (
      err.code === 'figma_not_connected' ||
      err.code === 'figma_needs_reauth'
    ) {
      console.error(`✗ Figma is not connected (or token expired). Reconnect:`)
      console.error(`  open https://www.uselumo.ai/settings/integrations/figma`)
      return 1
    }
    throw e
  }
}
```

- [ ] **Step 2: Register in `cli/src/index.ts`**

```ts
import { taskFigmaRefresh } from './commands/task-figma-refresh'

taskFigma
  .command('refresh <task>')
  .description(
    'Re-fetch Figma metadata + thumbnail for every link on this task. Per-link failures isolated.'
  )
  .action(wrap((taskId: string) => taskFigmaRefresh({ identifier: taskId })))
```

- [ ] **Step 3: Smoke test**

```bash
cd cli && npm run build && cd ..
lumo task figma refresh --help
```

- [ ] **Step 4: Commit**

```bash
git add cli/src/commands/task-figma-refresh.ts cli/src/index.ts
git commit -m "feat: lumo task figma refresh command [LUM-104]"
```

---

## Task 17: Task context section rendering + lazy refresh

**Files:**

- Modify: `lib/services/task-context.service.ts`
- Modify: `cli/src/commands/task-context.ts`

- [ ] **Step 1: Add `figmaSection` to `TaskContext` interface**

In `lib/services/task-context.service.ts`, find `interface TaskContext` and add:

```ts
/** Pre-rendered "## Figma Designs" markdown; empty when no links attached. */
figmaSection: string
```

- [ ] **Step 2: Implement `renderFigmaSection`**

In `lib/services/task-context.service.ts`, alongside `renderWebLinkSection`, add:

```ts
import { taskFigmaLinkRepository } from '@/lib/repositories/task-figma-link.repository'
import { taskFigmaLinkService } from '@/lib/services/task-figma-link.service'
import { waitUntil } from '@vercel/functions'
import type { TaskFigmaLink } from '@prisma/client'

const FIGMA_STALE_MS = 25 * 24 * 3600 * 1000

function renderFigmaSection(links: TaskFigmaLink[]): string {
  if (links.length === 0) return ''
  const lines: string[] = ['## Figma Designs', '']
  for (const link of links) {
    const title = link.frameName
      ? `${link.fileName} · ${link.frameName}`
      : `${link.fileName} _(file-level)_`
    lines.push(`- **${title}**`)
    lines.push(`  - URL: ${link.url}`)
    if (link.thumbnailUrl) {
      lines.push(`  - Thumbnail: ![](${link.thumbnailUrl})`)
    } else {
      const reason = link.lastSyncError
        ? `_(sync failed: ${link.lastSyncError})_`
        : '_(thumbnail not yet fetched)_'
      lines.push(`  - Thumbnail unavailable ${reason}`)
    }
    lines.push(
      `  - Last synced: ${link.lastSyncedAt.toISOString().slice(0, 10)}`
    )
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}

function scheduleLazyRefresh(
  links: TaskFigmaLink[],
  workspaceId: string,
  actorMemberId: string,
  taskId: string
): void {
  const stale = links.some(
    l =>
      l.thumbnailFetchedAt === null ||
      Date.now() - l.thumbnailFetchedAt.getTime() > FIGMA_STALE_MS
  )
  if (!stale) return
  waitUntil(
    taskFigmaLinkService
      .refreshLinksForTask({ taskId, workspaceId, actorMemberId })
      .catch(() => {})
  )
}
```

- [ ] **Step 3: Plumb `actorMemberId` through `getContextForIdentifier`**

`getContextForIdentifier` currently takes `(workspaceId, identifier)`. Change its signature to `(workspaceId, actorMemberId, identifier)`. `verifyBearer` returns `{ user, workspace, apiKey }` (no `member`), so the caller must look up the WorkspaceMember row from the Clerk user id. Update the only caller, `app/api/tasks/context/[identifier]/route.ts`:

```ts
// Before:
const result = await taskContextService.getContextForIdentifier(
  identity.workspace.id,
  identifier
)

// After:
import { memberRepository } from '@/lib/repositories/member.repository'

const actor = await memberRepository.findByWorkspaceAndClerkId(
  identity.workspace.id,
  identity.user.id
)
if (!actor) return NextResponse.json({ error: 'Not a member' }, { status: 403 })

const result = await taskContextService.getContextForIdentifier(
  identity.workspace.id,
  actor.id,
  identifier
)
```

- [ ] **Step 4: Wire `renderFigmaSection` into `getContextForIdentifier`**

Inside the service method (after `webLinkSection` is computed), add:

```ts
const figmaLinks = await taskFigmaLinkRepository.listByTask(task.id)
const figmaSection = renderFigmaSection(figmaLinks)
if (figmaLinks.length > 0) {
  scheduleLazyRefresh(figmaLinks, workspaceId, actorMemberId, task.id)
}
// ... include figmaSection in the returned object alongside webLinkSection
```

- [ ] **Step 5: Update CLI TaskContextResponse + renderer**

In `cli/src/commands/task-context.ts`, find the `TaskContextResponse` interface and add `figmaSection: string`. In the place where sections are concatenated (look for `webLinkSection`), append `figmaSection` after it, before prior sessions.

- [ ] **Step 6: Typecheck + run existing context tests**

Run: `npx tsc --noEmit && npm test -- task-context`

Expected: clean typecheck; existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add lib/services/task-context.service.ts app/api/tasks/context/\[identifier\]/route.ts cli/src/commands/task-context.ts
git commit -m "feat: render Figma Designs section in task context [LUM-104]"
```

---

## Task 18: Settings UI — Figma integration

**Files:**

- Create: `app/workspace/[workspaceUrl]/settings/integrations/figma/page.tsx`
- Possibly modify: `app/workspace/[workspaceUrl]/settings/integrations/page.tsx` (add tile)

- [ ] **Step 1: Inspect existing integration tile pattern**

Read `app/workspace/[workspaceUrl]/settings/integrations/page.tsx` if it exists. If not, check how the GitHub or Slack integration settings page is structured — there must be one because we have those features. Mirror that pattern.

- [ ] **Step 2: Create Figma integration page**

Create `app/workspace/[workspaceUrl]/settings/integrations/figma/page.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'

interface IntegrationStatus {
  connected: boolean
  handle?: string
  email?: string | null
  needsReauth?: boolean
}

export default function FigmaIntegrationPage() {
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const search = useSearchParams()
  const [status, setStatus] = useState<IntegrationStatus | null>(null)

  useEffect(() => {
    if (!workspaceUrl) return
    fetch(`/api/figma/integration?workspaceUrl=${workspaceUrl}`)
      .then(r => r.json())
      .then(setStatus)
  }, [workspaceUrl, search])

  if (!status) return <div>Loading…</div>

  return (
    <div className='space-y-4'>
      <h1 className='text-2xl font-semibold'>Figma</h1>
      <p className='text-muted-foreground'>
        Attach Figma designs to tasks. Lumo reads file metadata via Figma OAuth.
      </p>

      {status.connected ? (
        <div className='space-y-2'>
          <p>
            Connected as <strong>@{status.handle}</strong>
            {status.email ? ` (${status.email})` : ''}.
          </p>
          {status.needsReauth && (
            <p className='text-destructive'>
              Token expired — please reconnect.
            </p>
          )}
          <Button
            variant='outline'
            onClick={async () => {
              await fetch(
                `/api/figma/integration?workspaceUrl=${workspaceUrl}`,
                { method: 'DELETE' }
              )
              setStatus({ connected: false })
            }}
          >
            Disconnect
          </Button>
          {status.needsReauth && (
            <Button asChild>
              <a href={`/api/figma/oauth?workspaceUrl=${workspaceUrl}`}>
                Reconnect
              </a>
            </Button>
          )}
        </div>
      ) : (
        <Button asChild>
          <a href={`/api/figma/oauth?workspaceUrl=${workspaceUrl}`}>
            Connect Figma
          </a>
        </Button>
      )}
    </div>
  )
}
```

> Engineer: the GitHub integration page uses `useParams` the same way — search for it under `app/workspace/` to match exactly. Use `react-intl` (`intl.formatMessage`) for visible strings; locale keys go in **every** file under `lib/i18n/`.

- [ ] **Step 3: Add tile to integrations index (if applicable)**

If `app/workspace/[workspaceUrl]/settings/integrations/page.tsx` is a tile-list page, add a Figma entry pointing to `./figma`. Match the existing tile styling.

- [ ] **Step 4: i18n strings**

Add the new visible strings (`"Connect Figma"`, `"Connected as ..."`, etc.) to all locale files in `lib/i18n/`. Per CLAUDE.md: "Never use English as a fallback for non-English locales — provide a proper translation for each language."

Engineer: check which locale files exist (`ls lib/i18n/`) and add a key per file. Use `intl.formatMessage` in the page if the existing pages use it.

- [ ] **Step 5: Manual verification**

```bash
npm run dev
```

Open `http://localhost:3000/workspace/<your-slug>/settings/integrations/figma` and verify:

- Page loads
- "Connect Figma" button is visible when disconnected
- Clicking Connect redirects to Figma's OAuth page (or hits the real Figma if env vars are set)

- [ ] **Step 6: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/settings/integrations/ lib/i18n/
git commit -m "feat: Figma integration settings page [LUM-104]"
```

---

## Task 19: Update SKILL.md

**Files:**

- Modify: `.claude/skills/lumo/SKILL.md`

- [ ] **Step 1: Update frontmatter description with new trigger keywords**

Find the YAML frontmatter at the top of `.claude/skills/lumo/SKILL.md`. In the `description:` field, append (within the comma-separated trigger words):

```
, figma, attach figma, figma link, 关联 figma, 设计稿, figma design
```

- [ ] **Step 2: Add a new section before "Out of scope" (or wherever document/sprint sections live)**

Insert this section near the other `task` subcommands (after the `task comment` section):

````markdown
### Task ↔ Figma Designs

#### `lumo task figma add <task> <url>` — attach a Figma file/frame

Fetches file name, frame name, and thumbnail via Figma OAuth and stores them
on the task.

```bash
lumo task figma add LUM-42 "https://www.figma.com/design/abc123/Onboarding?node-id=1-234"
```

If the URL omits `node-id`, the link is stored as file-level; the CLI prints
a `(file-level, thumbnail from "...")` note showing the auto-picked
representative frame.

Idempotent — re-adding the same URL within 7 days returns the existing row
without re-calling Figma.

**Not connected?** Errors with:

```
✗ You haven't connected Figma yet.
  Run: open https://www.uselumo.ai/settings/integrations/figma
```

#### `lumo task figma list <task>` — list attachments

```
$ lumo task figma list LUM-42
cfl_xxx1  Onboarding       Welcome screen       2026-05-28
cfl_xxx2  Design System    Button / Primary     2026-05-27
cfl_xxx3  Onboarding       (file-level)         2026-05-20  ⚠ thumbnail stale
```

`⚠ thumbnail stale` appears when `thumbnailFetchedAt > 25 days`.

#### `lumo task figma rm <task> <link-id-or-url>` — remove an attachment

Accepts a `cfl_*` cuid or the original URL. Idempotent (`Not linked: ...` + exit 0 when no match).

#### `lumo task figma refresh <task>` — manual refresh

Re-fetches metadata + thumbnail for every Figma link on the task. Per-link
failures are isolated.

```
$ lumo task figma refresh LUM-42
Refreshed 3 Figma links on LUM-42
  ✓ Onboarding · Welcome screen
  ✓ Onboarding · Sign-up form
  ✗ Design System · Button (file not accessible)
```

### When to suggest the `task figma` commands

- User pastes a Figma URL or mentions a design ("here's the mock", "the
  Figma is at...").
- User asks "what designs are linked to this task" or "show me the Figma
  for LUM-42".
- After implementing a UI change, suggest `lumo task figma refresh <task>`
  if the user mentioned updating the Figma source.

OAuth connection lives in the Web UI at
`/settings/integrations/figma`. The CLI does **not** have a `figma auth`
command; if the user tries `task figma add` without connecting, the error
message directs them to the Web UI.
````

- [ ] **Step 3: Verify SKILL.md is well-formed**

Quick scan — the section blends with the rest of the document, fence blocks balance, the existing structure is not broken.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/lumo/SKILL.md
git commit -m "docs: SKILL.md — task figma commands [LUM-104]"
```

---

## Task 20: End-to-end manual verification

**No code changes.** Run through the manual verification checklist to confirm everything works together.

- [ ] **Step 1: Env vars**

Set in `.env.local`:

```
FIGMA_OAUTH_CLIENT_ID=...
FIGMA_OAUTH_CLIENT_SECRET=...
FIGMA_OAUTH_REDIRECT_URI=http://localhost:3000/api/figma/callback
```

(`ENCRYPTION_KEY` for `lib/crypto.ts` is already set in the project — Figma reuses it for OAuth state. `NEXT_PUBLIC_APP_URL` is also already set.)

Register the OAuth app at https://www.figma.com/developers/apps with redirect URI = `http://localhost:3000/api/figma/callback`.

- [ ] **Step 2: OAuth round-trip**

```bash
npm run dev
```

Open `/workspace/<slug>/settings/integrations/figma`. Click Connect. Authorize on Figma. Expect redirect back with `?connected=1`, "Connected as @<your-handle>".

- [ ] **Step 3: Add a frame link**

```bash
lumo session attach LUM-104
lumo task figma add LUM-104 "https://www.figma.com/design/<your-test-key>/Test?node-id=1-2"
```

Expect: `Linked LUM-104 ↔ Figma "Test · <frame name>"`.

- [ ] **Step 4: Verify it appears in task context**

```bash
lumo task context LUM-104
```

Expect a `## Figma Designs` section with the frame name + thumbnail `![](...)`.

- [ ] **Step 5: List**

```bash
lumo task figma list LUM-104
```

Expect one row showing the link.

- [ ] **Step 6: File-level URL**

```bash
lumo task figma add LUM-104 "https://www.figma.com/design/<your-test-key>/Test"
```

Expect: `(file-level, thumbnail from "<picked frame>")` annotation.

- [ ] **Step 7: Refresh**

```bash
lumo task figma refresh LUM-104
```

Expect: per-link OK / fail report.

- [ ] **Step 8: Remove**

```bash
lumo task figma rm LUM-104 cfl_<id>
```

Expect: `Removed Figma link from LUM-104: "..."`.

- [ ] **Step 9: Disconnect → reauth error**

In the Web UI, Disconnect. Then `lumo task figma add LUM-104 <url>`.

Expect:

```
✗ You haven't connected Figma yet.
  Run: open https://www.uselumo.ai/settings/integrations/figma
```

- [ ] **Step 10: PR**

```bash
git push -u origin lumo/LUM-104-figma-task-context
gh pr create --title "feat: figma task context [LUM-104]" --body "$(cat <<'EOF'
## Summary
- Attach Figma file/frame URLs to tasks via Figma OAuth
- New CLI: `lumo task figma {add|list|rm|refresh}`
- New `## Figma Designs` section in `lumo task context`
- New tables: `figma_integrations`, `task_figma_links`

## Migration
Adds two tables. Requires `prisma migrate deploy` on next deploy. No backfill, no data deletion.

## Env vars (new)
- FIGMA_OAUTH_CLIENT_ID
- FIGMA_OAUTH_CLIENT_SECRET
- FIGMA_OAUTH_REDIRECT_URI

OAuth state encryption reuses `ENCRYPTION_KEY` (already set, used by GitHub integration).

## New npm packages
None.

## Test plan
- [x] Unit tests for parse-url, oauth, client, services, repositories
- [x] OAuth round-trip via Web UI
- [x] CLI add/list/rm/refresh against a real Figma file
- [x] `lumo task context LUM-104` shows the new section
- [x] Disconnect → CLI prints reauth message

## SKILL.md
Updated with new trigger words + section per CLAUDE.md mandate.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL returned.

---

## Self-Review Notes

- **Spec coverage**: §1 architecture (Tasks 1-11), §2 data model (Task 1), §3 OAuth (Tasks 3, 6, 10), §4 URL parsing + API (Tasks 2, 4, 7-9), §5 CLI (Tasks 12-16), §6 context render (Task 17), §7 tests (interspersed in each task).
- **Settings UI** is Task 18 — not in the spec body, but called out in §3.
- **Lazy refresh** plumbing through `task-context.service` has a known plumbing question (member id threading) — Task 17 Step 3 flags it explicitly with two options.
- **Engineer judgment calls** (existing repo helpers, locale file structure, integration tile placement) are flagged with `> Engineer:` notes — no hidden assumptions.
- **No cron** as the user explicitly removed — only lazy refresh + manual refresh remain.
