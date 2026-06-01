# Google Docs Import (with one-way sync) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user connect their own Google account, import a Google Doc into Lumo as a native Lumo Document, optionally bind it to a task, and later re-sync (Google → Lumo, overwrite) on demand.

**Architecture:** A new per-user Google Drive OAuth integration mirrors the existing `FigmaIntegration` (encrypted access/refresh tokens, `@@unique([workspaceId, memberId])`, client factory with auto-refresh). Importing fetches the doc as markdown via Google Drive's native `files/{id}/export?mimeType=text/markdown`, then reuses the existing `documentService.createDocument` (markdown → HTML) and `documentService.updateDocument` (re-sync) paths. The Document row stores source metadata (`googleDocId`, importer member id, syncedAt, syncError). Sync always runs with the **importer's** stored token (owner model). Once imported, the Doc follows Lumo's own PRIVATE/SHARED/WORKSPACE model — no Google ACL mirroring.

**Tech Stack:** Next.js 14 App Router, TypeScript (strict), Prisma + Neon Postgres, Clerk auth, `lib/crypto.ts` (AES-256-GCM), `markdown-it`/turndown via `@/lib/utils/markdown-tiptap`, Jest, the `lumo` CLI (commander).

**Decisions locked during design (do not re-litigate):**

- Import Google Doc → native Lumo Doc, bind via existing `DocumentMention`. NOT a new external context-source type.
- Sync is ONE-WAY Google → Lumo and OVERWRITES the Lumo body. Two-way/merge is out of scope.
- OAuth is PER-USER at `/settings/integrations`. Per-doc access is enforced by Google at fetch time, not modeled in Lumo.
- Re-sync uses the IMPORTER's token (owner model). If the importer loses access, sync fails with a clear error.
- v1 does NOT validate over-sharing; only show a hint at import time. No background polling — manual one-click only.
- Source metadata stored as fields on `Document` (not a separate table). YAGNI for a single source.

**Env vars required (note in PR description, add to `.env.example`):**

- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URI` (e.g. `https://www.uselumo.ai/api/google-drive/callback`)
- (`ENCRYPTION_KEY` already exists and is reused.)

---

## File Structure

**Create:**

- `prisma/migrations/<timestamp>_add_google_drive_integration_and_doc_source/migration.sql` — new table + Document columns
- `lib/integrations/google-drive/oauth.ts` — authorize URL, code exchange, refresh
- `lib/integrations/google-drive/types.ts` — token/userinfo/file response types
- `lib/integrations/google-drive/client.ts` — authenticated Drive client factory (export markdown, get metadata) with auto-refresh
- `lib/integrations/google-drive/parse-url.ts` — extract fileId from a Google Doc URL/id
- `lib/repositories/google-drive-integration.repository.ts` — CRUD on `GoogleDriveIntegration`
- `lib/services/google-drive-integration.service.ts` — OAuth state encode/decode, completeOauthFlow, disconnect, getDecryptedTokens, getClientForMember
- `lib/services/google-docs-import.service.ts` — import + resync orchestration
- `app/api/google-drive/oauth/route.ts` — GET initiate
- `app/api/google-drive/callback/route.ts` — GET callback
- `app/api/google-drive/status/route.ts` — GET connection status (for the UI card)
- `app/api/google-drive/route.ts` — DELETE disconnect
- `app/api/documents/import-google/route.ts` — POST import a Google Doc
- `app/api/documents/[id]/sync-google/route.ts` — POST re-sync an imported doc
- `app/workspace/[workspaceUrl]/components/GoogleDriveIntegrationCard.tsx` — settings card
- `app/workspace/[workspaceUrl]/hooks/useGoogleDriveIntegration.ts` — status/disconnect hook
- `cli/src/commands/doc-import-gdoc.ts` — `lumo doc import-gdoc <url>`
- `cli/src/commands/doc-sync.ts` — `lumo doc sync <doc>`
- Test files (one per unit, see tasks)

**Modify:**

- `prisma/schema.prisma` — add `GoogleDriveIntegration` model + 4 fields on `Document` + back-relations on `Workspace` and `WorkspaceMember`
- `lib/services/document.service.ts` — extend `CreateDocumentInput`/`UpdateDocumentInput` to carry source fields through to the repo
- `lib/repositories/document.repository.ts` — accept source fields on create/update, add `findByGoogleDocId`, add a source-metadata reader
- `app/workspace/[workspaceUrl]/constants.ts` — add `API.googleDrive` URL helpers
- `app/workspace/[workspaceUrl]/components/pages/IntegrationsPage.tsx` — render the new card
- `cli/src/index.ts` — register `doc import-gdoc` and `doc sync`
- `lib/i18n/*.json` — every locale file gets the new `googleDrive.*` keys
- `.claude/skills/lumo/SKILL.md` — document the two new `doc` subcommands
- `.env.example` — add the three `GOOGLE_OAUTH_*` vars

---

## Phase 0 — Schema & migration

### Task 1: Add `GoogleDriveIntegration` model + Document source fields

**Files:**

- Modify: `prisma/schema.prisma` (Document model ~922-965; WorkspaceMember relations ~176-193 and ~275-290; append new model near Figma ~1552)
- Create: `prisma/migrations/<timestamp>_add_google_drive_integration_and_doc_source/migration.sql`

- [ ] **Step 1: Add 4 source fields to the `Document` model**

In `prisma/schema.prisma`, inside `model Document { ... }`, after the `summaryGeneratedAt DateTime?` line (line 929), add:

```prisma
  // Google Docs import source (LUM-127). Null for native docs.
  googleDocId        String? // Google Drive fileId this doc mirrors
  googleDocImporterId String? // WorkspaceMember whose Google token re-syncs run as
  googleDocSyncedAt  DateTime? // last successful Google → Lumo sync
  googleDocSyncError String?  @db.Text // last sync failure reason, cleared on success
```

And add an index near the other `@@index` lines (after line 964):

```prisma
  @@index([workspaceId, googleDocId])
```

- [ ] **Step 2: Add the `GoogleDriveIntegration` model**

Append after the `FigmaIntegration` model (after line 1551):

```prisma
// ─── Google Drive Integration ────────────────────────────────────────────────

model GoogleDriveIntegration {
  id           String   @id @default(cuid())
  workspaceId  String
  memberId     String
  accessToken  String   // AES-256-GCM encrypted via lib/crypto.ts
  refreshToken String   // same encryption
  expiresAt    DateTime
  googleUserId String
  googleEmail  String?
  scopes       String[]
  needsReauth  Boolean  @default(false)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  workspace Workspace       @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  member    WorkspaceMember @relation(fields: [memberId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, memberId])
  @@index([workspaceId])
  @@map("google_drive_integrations")
}
```

- [ ] **Step 3: Add back-relations on Workspace and WorkspaceMember**

Find the two `figmaIntegrations  FigmaIntegration[]` lines (the Workspace model ~line 193 and the WorkspaceMember model ~line 290). Directly under each, add:

```prisma
  googleDriveIntegrations GoogleDriveIntegration[]
```

(Both the workspace-side and member-side back-relations are required or `prisma validate` fails.)

- [ ] **Step 4: Generate the migration SQL**

Run: `npx prisma migrate dev --name add_google_drive_integration_and_doc_source --create-only`
Expected: a new folder `prisma/migrations/<timestamp>_add_google_drive_integration_and_doc_source/` containing `migration.sql` with `CREATE TABLE "google_drive_integrations"`, `ALTER TABLE "Document" ADD COLUMN "googleDocId"` (×4), and the new index.

If Prisma rejects with P3008/P3012 drift, follow the CLAUDE.md drift workaround (hand-write SQL → `npx prisma db execute --file` → `npx prisma migrate resolve --applied`). Do NOT `migrate reset`.

- [ ] **Step 5: Apply + regenerate client**

Run: `npx prisma migrate dev` then `npx prisma generate`
Expected: migration applied to dev DB; `GoogleDriveIntegration` available on the Prisma client.

- [ ] **Step 6: Verify the client picked up the new fields**

Run: `npx tsc --noEmit`
Expected: no errors. (If you see "Property 'googleDocId' does not exist", the generate step did not run — re-run `npx prisma generate`.)

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add GoogleDriveIntegration model + Document source fields [LUM-127]"
```

---

## Phase 1 — Google Drive OAuth integration (independently shippable)

### Task 2: OAuth module (authorize / exchange / refresh)

**Files:**

- Create: `lib/integrations/google-drive/types.ts`
- Create: `lib/integrations/google-drive/oauth.ts`
- Test: `__tests__/lib/integrations/google-drive/oauth.test.ts`

- [ ] **Step 1: Write the types**

`lib/integrations/google-drive/types.ts`:

```typescript
export interface GoogleTokenResponse {
  access_token: string
  refresh_token?: string // only returned on first consent / prompt=consent
  expires_in: number // seconds
  scope: string
  token_type: 'Bearer'
}

export interface GoogleUserInfo {
  sub: string // stable Google user id
  email?: string
  email_verified?: boolean
}

export interface GoogleFileMetadata {
  id: string
  name: string
  mimeType: string
}
```

- [ ] **Step 2: Write the failing test**

`__tests__/lib/integrations/google-drive/oauth.test.ts`:

```typescript
import {
  getAuthorizeUrl,
  GOOGLE_OAUTH_SCOPES,
} from '@/lib/integrations/google-drive/oauth'

describe('google-drive oauth', () => {
  const ENV = process.env
  beforeEach(() => {
    process.env = {
      ...ENV,
      GOOGLE_OAUTH_CLIENT_ID: 'cid',
      GOOGLE_OAUTH_CLIENT_SECRET: 'secret',
      GOOGLE_OAUTH_REDIRECT_URI: 'https://app.test/api/google-drive/callback',
    }
  })
  afterEach(() => {
    process.env = ENV
  })

  it('builds an authorize URL requesting offline access + consent + readonly scope', () => {
    const url = new URL(getAuthorizeUrl({ state: 'abc' }))
    expect(url.origin + url.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth'
    )
    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://app.test/api/google-drive/callback'
    )
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('state')).toBe('abc')
    expect(url.searchParams.get('scope')).toContain(
      'https://www.googleapis.com/auth/drive.readonly'
    )
    expect(GOOGLE_OAUTH_SCOPES.length).toBeGreaterThan(0)
  })

  it('throws a clear error when an env var is missing', () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID
    expect(() => getAuthorizeUrl({ state: 'abc' })).toThrow(
      'GOOGLE_OAUTH_CLIENT_ID'
    )
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- google-drive/oauth.test.ts`
Expected: FAIL — `getAuthorizeUrl` not found.

- [ ] **Step 4: Implement `oauth.ts`**

`lib/integrations/google-drive/oauth.ts`:

```typescript
import type { GoogleTokenResponse } from './types'

const GOOGLE_AUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

// Read-only Drive access is enough to export a Doc as markdown; openid+email
// let us identify the connected account for the settings card.
export const GOOGLE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'openid',
  'email',
] as const

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var: ${name}`)
  return v
}

export function getAuthorizeUrl(opts: { state: string }): string {
  const url = new URL(GOOGLE_AUTH_BASE)
  url.searchParams.set('client_id', requireEnv('GOOGLE_OAUTH_CLIENT_ID'))
  url.searchParams.set('redirect_uri', requireEnv('GOOGLE_OAUTH_REDIRECT_URI'))
  url.searchParams.set('scope', GOOGLE_OAUTH_SCOPES.join(' '))
  url.searchParams.set('response_type', 'code')
  // access_type=offline + prompt=consent guarantees a refresh_token even on
  // re-consent, which the owner-token re-sync model depends on.
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('include_granted_scopes', 'true')
  url.searchParams.set('state', opts.state)
  return url.toString()
}

export async function exchangeCode(code: string): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    client_id: requireEnv('GOOGLE_OAUTH_CLIENT_ID'),
    client_secret: requireEnv('GOOGLE_OAUTH_CLIENT_SECRET'),
    redirect_uri: requireEnv('GOOGLE_OAUTH_REDIRECT_URI'),
    code,
    grant_type: 'authorization_code',
  })
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status}`)
  return (await res.json()) as GoogleTokenResponse
}

export async function refreshAccessToken(
  refreshToken: string
): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    client_id: requireEnv('GOOGLE_OAUTH_CLIENT_ID'),
    client_secret: requireEnv('GOOGLE_OAUTH_CLIENT_SECRET'),
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status}`)
  // Note: refresh responses usually omit refresh_token — callers must keep the
  // existing one when the response doesn't include a new value.
  return (await res.json()) as GoogleTokenResponse
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- google-drive/oauth.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/integrations/google-drive/oauth.ts lib/integrations/google-drive/types.ts __tests__/lib/integrations/google-drive/oauth.test.ts
git commit -m "feat: google-drive oauth module [LUM-127]"
```

### Task 3: URL parser (extract fileId)

**Files:**

- Create: `lib/integrations/google-drive/parse-url.ts`
- Test: `__tests__/lib/integrations/google-drive/parse-url.test.ts`

- [ ] **Step 1: Write the failing test**

`__tests__/lib/integrations/google-drive/parse-url.test.ts`:

```typescript
import { parseGoogleDocId } from '@/lib/integrations/google-drive/parse-url'

describe('parseGoogleDocId', () => {
  it('extracts the fileId from a standard /document/d/<id>/edit url', () => {
    expect(
      parseGoogleDocId(
        'https://docs.google.com/document/d/1AbC_def-123/edit#heading=h.x'
      )
    ).toBe('1AbC_def-123')
  })
  it('extracts from a drive open?id= url', () => {
    expect(
      parseGoogleDocId('https://drive.google.com/open?id=1AbC_def-123')
    ).toBe('1AbC_def-123')
  })
  it('accepts a bare file id', () => {
    expect(parseGoogleDocId('1AbC_def-123')).toBe('1AbC_def-123')
  })
  it('returns null for a non-google url', () => {
    expect(parseGoogleDocId('https://example.com/foo')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- google-drive/parse-url.test.ts`
Expected: FAIL — `parseGoogleDocId` not found.

- [ ] **Step 3: Implement `parse-url.ts`**

```typescript
// Google file ids are URL-safe base64-ish: letters, digits, _ and -.
const ID_RE = /^[A-Za-z0-9_-]{10,}$/

export function parseGoogleDocId(input: string): string | null {
  const trimmed = input.trim()
  if (ID_RE.test(trimmed)) return trimmed
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (!/(^|\.)google\.com$/.test(url.hostname)) return null
  // /document/d/<id>/edit  or  /file/d/<id>/...
  const pathMatch = url.pathname.match(/\/d\/([A-Za-z0-9_-]{10,})/)
  if (pathMatch) return pathMatch[1]
  // open?id=<id>
  const idParam = url.searchParams.get('id')
  if (idParam && ID_RE.test(idParam)) return idParam
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- google-drive/parse-url.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/google-drive/parse-url.ts __tests__/lib/integrations/google-drive/parse-url.test.ts
git commit -m "feat: google doc url parser [LUM-127]"
```

### Task 4: Drive client factory (export markdown + metadata, auto-refresh)

**Files:**

- Create: `lib/integrations/google-drive/client.ts`
- Test: `__tests__/lib/integrations/google-drive/client.test.ts`

- [ ] **Step 1: Write the failing test**

`__tests__/lib/integrations/google-drive/client.test.ts`:

```typescript
import {
  createGoogleDriveClient,
  GoogleNeedsReauthError,
} from '@/lib/integrations/google-drive/client'

const realFetch = global.fetch

function mockFetchSequence(responses: Array<() => Response>) {
  let i = 0
  global.fetch = jest.fn(async () =>
    responses[i++]()
  ) as unknown as typeof fetch
}

afterEach(() => {
  global.fetch = realFetch
  jest.restoreAllMocks()
})

const futureTokens = {
  accessToken: 'at',
  refreshToken: 'rt',
  expiresAt: new Date(Date.now() + 3600_000),
}

describe('google drive client', () => {
  it('exports a doc as markdown', async () => {
    mockFetchSequence([() => new Response('# Title\n\nbody', { status: 200 })])
    const client = createGoogleDriveClient({
      tokens: futureTokens,
      onTokensRefreshed: async () => {},
    })
    const md = await client.exportMarkdown('fileId123')
    expect(md).toBe('# Title\n\nbody')
  })

  it('throws GoogleNeedsReauthError on a 401 that cannot be refreshed', async () => {
    mockFetchSequence([() => new Response('nope', { status: 401 })])
    const client = createGoogleDriveClient({
      tokens: { ...futureTokens, refreshToken: '' },
      onTokensRefreshed: async () => {},
    })
    await expect(client.exportMarkdown('fileId123')).rejects.toBeInstanceOf(
      GoogleNeedsReauthError
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- google-drive/client.test.ts`
Expected: FAIL — `createGoogleDriveClient` not found.

- [ ] **Step 3: Implement `client.ts`**

```typescript
import { refreshAccessToken } from './oauth'
import type { GoogleFileMetadata } from './types'

export class GoogleNeedsReauthError extends Error {
  constructor() {
    super('Google Drive integration needs re-auth')
    this.name = 'GoogleNeedsReauthError'
  }
}

export interface GoogleDriveClientTokens {
  accessToken: string
  refreshToken: string
  expiresAt: Date
}

export interface GoogleDriveClient {
  getMetadata(fileId: string): Promise<GoogleFileMetadata>
  exportMarkdown(fileId: string): Promise<string>
}

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3'
const REFRESH_THRESHOLD_MS = 60_000

export function createGoogleDriveClient(opts: {
  tokens: GoogleDriveClientTokens
  onTokensRefreshed: (next: GoogleDriveClientTokens) => Promise<void>
}): GoogleDriveClient {
  let tokens = opts.tokens

  async function doRefresh(): Promise<boolean> {
    if (!tokens.refreshToken) return false
    const next = await refreshAccessToken(tokens.refreshToken).catch(() => null)
    if (!next) return false
    tokens = {
      // Google omits refresh_token on refresh — keep the existing one.
      accessToken: next.access_token,
      refreshToken: next.refresh_token ?? tokens.refreshToken,
      expiresAt: new Date(Date.now() + next.expires_in * 1000),
    }
    await opts.onTokensRefreshed(tokens)
    return true
  }

  async function ensureFresh(): Promise<void> {
    if (tokens.expiresAt.getTime() - Date.now() > REFRESH_THRESHOLD_MS) return
    await doRefresh()
  }

  // `raw` lets exportMarkdown read text/* while getMetadata reads JSON.
  async function call(path: string): Promise<Response> {
    await ensureFresh()
    let res = await fetch(`${DRIVE_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    })
    if (res.status === 401) {
      const ok = await doRefresh()
      if (!ok) throw new GoogleNeedsReauthError()
      res = await fetch(`${DRIVE_API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      })
      if (res.status === 401) throw new GoogleNeedsReauthError()
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      const err = new Error(
        `Google Drive API ${res.status}: ${body.slice(0, 200)}`
      ) as Error & { status: number }
      err.status = res.status
      throw err
    }
    return res
  }

  return {
    async getMetadata(fileId) {
      const res = await call(
        `/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType`
      )
      return (await res.json()) as GoogleFileMetadata
    },
    async exportMarkdown(fileId) {
      const res = await call(
        `/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent('text/markdown')}`
      )
      return await res.text()
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- google-drive/client.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/google-drive/client.ts __tests__/lib/integrations/google-drive/client.test.ts
git commit -m "feat: google drive client factory [LUM-127]"
```

### Task 5: Integration repository

**Files:**

- Create: `lib/repositories/google-drive-integration.repository.ts`
- Test: covered indirectly by service tests (Task 6); a thin Prisma wrapper needs no isolated unit test (matches `figma-integration.repository.ts`, which has none).

- [ ] **Step 1: Implement the repository (mirror of figma-integration.repository.ts)**

```typescript
import { prisma } from '@/lib/db/prisma'
import type { GoogleDriveIntegration } from '@prisma/client'

export const googleDriveIntegrationRepository = {
  findByMember(
    workspaceId: string,
    memberId: string
  ): Promise<GoogleDriveIntegration | null> {
    return prisma.googleDriveIntegration.findUnique({
      where: { workspaceId_memberId: { workspaceId, memberId } },
    })
  },

  findById(id: string): Promise<GoogleDriveIntegration | null> {
    return prisma.googleDriveIntegration.findUnique({ where: { id } })
  },

  upsert(input: {
    workspaceId: string
    memberId: string
    accessToken: string
    refreshToken: string
    expiresAt: Date
    googleUserId: string
    googleEmail: string | null
    scopes: string[]
  }): Promise<GoogleDriveIntegration> {
    const { workspaceId, memberId, ...data } = input
    return prisma.googleDriveIntegration.upsert({
      where: { workspaceId_memberId: { workspaceId, memberId } },
      create: { workspaceId, memberId, ...data, needsReauth: false },
      update: { ...data, needsReauth: false },
    })
  },

  updateTokens(
    id: string,
    next: { accessToken: string; refreshToken: string; expiresAt: Date }
  ): Promise<GoogleDriveIntegration> {
    return prisma.googleDriveIntegration.update({ where: { id }, data: next })
  },

  markNeedsReauth(id: string): Promise<GoogleDriveIntegration> {
    return prisma.googleDriveIntegration.update({
      where: { id },
      data: { needsReauth: true },
    })
  },

  delete(workspaceId: string, memberId: string): Promise<void> {
    return prisma.googleDriveIntegration
      .delete({ where: { workspaceId_memberId: { workspaceId, memberId } } })
      .then(() => undefined)
      .catch(() => undefined) // idempotent
  },
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/repositories/google-drive-integration.repository.ts
git commit -m "feat: google drive integration repository [LUM-127]"
```

### Task 6: Integration service (state, completeOauthFlow, getClientForMember)

**Files:**

- Create: `lib/services/google-drive-integration.service.ts`
- Test: `__tests__/lib/services/google-drive-integration.service.test.ts`

- [ ] **Step 1: Write the failing test (state round-trip + TTL)**

`__tests__/lib/services/google-drive-integration.service.test.ts`:

```typescript
import {
  encodeOauthState,
  decodeOauthState,
} from '@/lib/services/google-drive-integration.service'

// lib/crypto needs an ENCRYPTION_KEY; jest setup already provides a test key in
// other crypto-dependent suites (figma). If not present, set one here.
beforeAll(() => {
  if (!process.env.ENCRYPTION_KEY) {
    process.env.ENCRYPTION_KEY = '0'.repeat(64)
  }
})

describe('google-drive oauth state', () => {
  it('round-trips a valid payload', () => {
    const token = encodeOauthState({
      workspaceId: 'ws1',
      memberId: 'm1',
      workspaceUrl: 'lumo',
    })
    expect(decodeOauthState(token)).toEqual({
      workspaceId: 'ws1',
      memberId: 'm1',
      workspaceUrl: 'lumo',
    })
  })

  it('rejects a garbage state', () => {
    expect(decodeOauthState('not-a-real-token')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- google-drive-integration.service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service (mirror figma-integration.service.ts)**

`lib/services/google-drive-integration.service.ts`:

```typescript
import { encrypt, decrypt } from '@/lib/crypto'
import { googleDriveIntegrationRepository } from '@/lib/repositories/google-drive-integration.repository'
import {
  exchangeCode,
  GOOGLE_OAUTH_SCOPES,
} from '@/lib/integrations/google-drive/oauth'
import {
  createGoogleDriveClient,
  type GoogleDriveClient,
} from '@/lib/integrations/google-drive/client'
import type { GoogleUserInfo } from '@/lib/integrations/google-drive/types'

export interface OauthStatePayload {
  workspaceId: string
  memberId: string
  workspaceUrl: string
}

interface OauthStateEnvelope extends OauthStatePayload {
  iat: number
}

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000

export function encodeOauthState(payload: OauthStatePayload): string {
  const envelope: OauthStateEnvelope = { ...payload, iat: Date.now() }
  return encrypt(JSON.stringify(envelope))
}

export function decodeOauthState(state: string): OauthStatePayload | null {
  try {
    const parsed = JSON.parse(decrypt(state)) as OauthStateEnvelope
    if (
      typeof parsed.workspaceId !== 'string' ||
      typeof parsed.memberId !== 'string' ||
      typeof parsed.workspaceUrl !== 'string' ||
      typeof parsed.iat !== 'number'
    ) {
      return null
    }
    if (Date.now() - parsed.iat > OAUTH_STATE_TTL_MS) return null
    return {
      workspaceId: parsed.workspaceId,
      memberId: parsed.memberId,
      workspaceUrl: parsed.workspaceUrl,
    }
  } catch {
    return null
  }
}

async function fetchGoogleUser(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`Google userinfo failed: ${res.status}`)
  return (await res.json()) as GoogleUserInfo
}

export async function completeOauthFlow(input: {
  workspaceId: string
  memberId: string
  code: string
}): Promise<void> {
  const tokens = await exchangeCode(input.code)
  if (!tokens.refresh_token) {
    // Without a refresh token the owner-sync model can't work later.
    throw new Error(
      'Google did not return a refresh token; re-consent required'
    )
  }
  const user = await fetchGoogleUser(tokens.access_token)
  await googleDriveIntegrationRepository.upsert({
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    accessToken: encrypt(tokens.access_token),
    refreshToken: encrypt(tokens.refresh_token),
    expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    googleUserId: user.sub,
    googleEmail: user.email ?? null,
    scopes: [...GOOGLE_OAUTH_SCOPES],
  })
}

export async function disconnectIntegration(
  workspaceId: string,
  memberId: string
): Promise<void> {
  await googleDriveIntegrationRepository.delete(workspaceId, memberId)
}

export async function getStatus(
  workspaceId: string,
  memberId: string
): Promise<{ connected: boolean; email: string | null; needsReauth: boolean }> {
  const row = await googleDriveIntegrationRepository.findByMember(
    workspaceId,
    memberId
  )
  if (!row) return { connected: false, email: null, needsReauth: false }
  return {
    connected: true,
    email: row.googleEmail,
    needsReauth: row.needsReauth,
  }
}

/**
 * Build an authenticated Drive client for a specific member's stored tokens.
 * Used by the import/sync service. Refreshed tokens are persisted back via the
 * repository, and a hard 401 marks the row needsReauth.
 */
export async function getClientForMember(
  workspaceId: string,
  memberId: string
): Promise<GoogleDriveClient> {
  const row = await googleDriveIntegrationRepository.findByMember(
    workspaceId,
    memberId
  )
  if (!row) {
    throw Object.assign(new Error('Google Drive not connected'), {
      status: 403,
      code: 'google_not_connected',
    })
  }
  if (row.needsReauth) {
    throw Object.assign(new Error('Google Drive needs reauth'), {
      status: 403,
      code: 'google_needs_reauth',
    })
  }
  return createGoogleDriveClient({
    tokens: {
      accessToken: decrypt(row.accessToken),
      refreshToken: decrypt(row.refreshToken),
      expiresAt: row.expiresAt,
    },
    onTokensRefreshed: async next => {
      await googleDriveIntegrationRepository.updateTokens(row.id, {
        accessToken: encrypt(next.accessToken),
        refreshToken: encrypt(next.refreshToken),
        expiresAt: next.expiresAt,
      })
    },
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- google-drive-integration.service.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/services/google-drive-integration.service.ts __tests__/lib/services/google-drive-integration.service.test.ts
git commit -m "feat: google drive integration service [LUM-127]"
```

### Task 7: OAuth API routes (oauth / callback / status / disconnect)

**Files:**

- Create: `app/api/google-drive/oauth/route.ts`
- Create: `app/api/google-drive/callback/route.ts`
- Create: `app/api/google-drive/status/route.ts`
- Create: `app/api/google-drive/route.ts`
- Test: routes are thin glue mirroring Figma's (which have no isolated route tests); rely on the service tests + manual verification in Task 16. No new test file.

- [ ] **Step 1: `oauth/route.ts` (mirror Figma)**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { getAuthorizeUrl } from '@/lib/integrations/google-drive/oauth'
import { encodeOauthState } from '@/lib/services/google-drive-integration.service'

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

- [ ] **Step 2: `callback/route.ts` (mirror Figma; `google_error`/`connected` query params)**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import {
  decodeOauthState,
  completeOauthFlow,
} from '@/lib/services/google-drive-integration.service'

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const state = request.nextUrl.searchParams.get('state')
  const errorParam = request.nextUrl.searchParams.get('error')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  if (errorParam || !state) {
    return NextResponse.redirect(`${appUrl}/?google_error=1`)
  }

  const decoded = decodeOauthState(state)
  if (!decoded) {
    return NextResponse.redirect(`${appUrl}/?google_error=invalid_state`)
  }

  const settingsUrl = `${appUrl}/workspace/${decoded.workspaceUrl}/settings/integrations`

  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const ws = await getUserWorkspace(authResult.userId)
  if (
    !ws ||
    ws.workspaceId !== decoded.workspaceId ||
    ws.member.id !== decoded.memberId
  ) {
    return NextResponse.redirect(
      `${settingsUrl}?google_error=identity_mismatch`
    )
  }

  if (!code) {
    return NextResponse.redirect(`${settingsUrl}?google_error=no_code`)
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
      `${settingsUrl}?google_error=${encodeURIComponent(msg.slice(0, 64))}`
    )
  }

  return NextResponse.redirect(`${settingsUrl}?connected=1`)
}
```

- [ ] **Step 3: `status/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { getStatus } from '@/lib/services/google-drive-integration.service'

export async function GET() {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const ws = await getUserWorkspace(authResult.userId)
  if (!ws) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const status = await getStatus(ws.workspaceId, ws.member.id)
  return NextResponse.json(status)
}
```

- [ ] **Step 4: `route.ts` (DELETE disconnect)**

```typescript
import { NextResponse } from 'next/server'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { disconnectIntegration } from '@/lib/services/google-drive-integration.service'

export async function DELETE() {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const ws = await getUserWorkspace(authResult.userId)
  if (!ws) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await disconnectIntegration(ws.workspaceId, ws.member.id)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add app/api/google-drive/
git commit -m "feat: google drive oauth + status + disconnect routes [LUM-127]"
```

---

## Phase 2 — Import & sync

### Task 8: Thread source fields through document repository

**Files:**

- Modify: `lib/repositories/document.repository.ts` (`CreateDocumentData`, `DocumentUpdateData`, `create`, `update`; add `findByGoogleDocId`, `findSourceMeta`)
- Test: `__tests__/lib/repositories/document-google-source.repository.test.ts` (mock prisma)

- [ ] **Step 1: Write the failing test**

`__tests__/lib/repositories/document-google-source.repository.test.ts`:

```typescript
import { documentRepository } from '@/lib/repositories/document.repository'
import { prisma } from '@/lib/db/prisma'

jest.mock('@/lib/db/prisma', () => ({
  prisma: { document: { findFirst: jest.fn() } },
}))

describe('documentRepository.findByGoogleDocId', () => {
  it('queries by workspace + googleDocId', async () => {
    ;(prisma.document.findFirst as jest.Mock).mockResolvedValue({ id: 'doc1' })
    const row = await documentRepository.findByGoogleDocId('ws1', 'gdoc1')
    expect(prisma.document.findFirst).toHaveBeenCalledWith({
      where: { workspaceId: 'ws1', googleDocId: 'gdoc1' },
    })
    expect(row).toEqual({ id: 'doc1' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- document-google-source.repository.test.ts`
Expected: FAIL — `findByGoogleDocId` not a function.

- [ ] **Step 3: Extend the repo interfaces + create/update + add methods**

In `lib/repositories/document.repository.ts`:

Add to `CreateDocumentData` (the interface used by `create`) these optional fields:

```typescript
  googleDocId?: string | null
  googleDocImporterId?: string | null
  googleDocSyncedAt?: Date | null
```

Add to `DocumentUpdateData` (the interface used by `update`/`updateWithChildrenAndMentions`):

```typescript
  googleDocSyncedAt?: Date | null
  googleDocSyncError?: string | null
```

Ensure `create({ ... })` passes the three create fields through to `prisma.document.create` (they are plain scalar columns; if the method spreads `data` they pass automatically — otherwise add them to the `data: { ... }` object). Ensure the `update`/`updateWithChildrenAndMentions` paths copy `googleDocSyncedAt` and `googleDocSyncError` into the Prisma `data` when present.

Add two new methods to the exported `documentRepository` object:

```typescript
  findByGoogleDocId(workspaceId: string, googleDocId: string) {
    return prisma.document.findFirst({
      where: { workspaceId, googleDocId },
    })
  },

  findSourceMeta(id: string, workspaceId: string) {
    return prisma.document.findFirst({
      where: { id, workspaceId },
      select: {
        id: true,
        googleDocId: true,
        googleDocImporterId: true,
        googleDocSyncedAt: true,
      },
    })
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- document-google-source.repository.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add lib/repositories/document.repository.ts __tests__/lib/repositories/document-google-source.repository.test.ts
git commit -m "feat: thread google source fields through document repo [LUM-127]"
```

### Task 9: Pass source fields through document service create

**Files:**

- Modify: `lib/services/document.service.ts` (`CreateDocumentInput` + `createDocument`)
- Test: `__tests__/lib/services/document-google-source.service.test.ts`

- [ ] **Step 1: Write the failing test**

`__tests__/lib/services/document-google-source.service.test.ts`:

```typescript
import { documentRepository } from '@/lib/repositories/document.repository'

jest.mock('@/lib/repositories/document.repository')
jest.mock('@/lib/repositories/tag.repository', () => ({ tagRepository: {} }))
jest.mock('@clerk/nextjs/server', () => ({
  clerkClient: async () => ({
    users: { getUserList: async () => ({ data: [] }) },
  }),
}))
jest.mock('@vercel/functions', () => ({
  waitUntil: (p: Promise<unknown>) => p,
}))

import { documentService } from '@/lib/services/document.service'

describe('createDocument with google source', () => {
  it('forwards googleDocId / importer / syncedAt to the repository', async () => {
    const repo = documentRepository as jest.Mocked<typeof documentRepository>
    repo.getMaxSortOrder.mockResolvedValue(0)
    repo.create.mockResolvedValue({
      id: 'doc1',
      createdBy: { id: 'm1', clerkId: 'ck1' },
    } as never)
    repo.updateWithChildrenAndMentions.mockResolvedValue({} as never)

    const syncedAt = new Date('2026-05-31T00:00:00Z')
    await documentService.createDocument('ws1', 'm1', {
      title: 'Imported',
      visibility: 'PRIVATE',
      contentMarkdown: '# hi',
      googleDocId: 'gdoc1',
      googleDocImporterId: 'm1',
      googleDocSyncedAt: syncedAt,
    })

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        googleDocId: 'gdoc1',
        googleDocImporterId: 'm1',
        googleDocSyncedAt: syncedAt,
      })
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- document-google-source.service.test.ts`
Expected: FAIL — type error / fields not forwarded.

- [ ] **Step 3: Extend `CreateDocumentInput` + forward in `createDocument`**

In `lib/services/document.service.ts`, extend the interface (after `tagIds?: string[]`, line 29):

```typescript
  googleDocId?: string | null
  googleDocImporterId?: string | null
  googleDocSyncedAt?: Date | null
```

In `createDocument`, extend the `documentRepository.create({ ... })` call (around line 338) to pass the three fields:

```typescript
const document = await documentRepository.create({
  title: data.title,
  emoji: data.emoji ?? null,
  parentId,
  projectId: data.projectId ?? null,
  workspaceId,
  createdById: memberId,
  visibility: data.visibility,
  sortOrder: maxSortOrder + 1,
  googleDocId: data.googleDocId ?? null,
  googleDocImporterId: data.googleDocImporterId ?? null,
  googleDocSyncedAt: data.googleDocSyncedAt ?? null,
  ...(content !== undefined ? { content } : {}),
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- document-google-source.service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/services/document.service.ts __tests__/lib/services/document-google-source.service.test.ts
git commit -m "feat: forward google source fields in createDocument [LUM-127]"
```

### Task 10: Import/sync orchestration service

**Files:**

- Create: `lib/services/google-docs-import.service.ts`
- Test: `__tests__/lib/services/google-docs-import.service.test.ts`

This service ties the Drive client to the document service. `importGoogleDoc` fetches metadata + markdown using the **acting** member's client, then creates a Document recording that member as importer. `resyncGoogleDoc` re-fetches using the **stored importer's** client and overwrites the body.

- [ ] **Step 1: Write the failing test**

`__tests__/lib/services/google-docs-import.service.test.ts`:

```typescript
jest.mock('@/lib/services/google-drive-integration.service')
jest.mock('@/lib/services/document.service')
jest.mock('@/lib/repositories/document.repository')

import { getClientForMember } from '@/lib/services/google-drive-integration.service'
import { documentService } from '@/lib/services/document.service'
import { documentRepository } from '@/lib/repositories/document.repository'
import { googleDocsImportService } from '@/lib/services/google-docs-import.service'

const fakeClient = {
  getMetadata: jest.fn(),
  exportMarkdown: jest.fn(),
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(getClientForMember as jest.Mock).mockResolvedValue(fakeClient)
})

describe('importGoogleDoc', () => {
  it('rejects an unparseable url', async () => {
    await expect(
      googleDocsImportService.importGoogleDoc('ws1', 'm1', {
        url: 'https://example.com',
      })
    ).rejects.toThrow(/not a valid google/i)
  })

  it('fetches metadata + markdown and creates a doc recording the importer', async () => {
    fakeClient.getMetadata.mockResolvedValue({
      id: 'g1',
      name: 'Spec',
      mimeType: 'application/vnd.google-apps.document',
    })
    fakeClient.exportMarkdown.mockResolvedValue('# Spec\n\nbody')
    ;(documentService.createDocument as jest.Mock).mockResolvedValue({
      id: 'doc1',
      slug: 'spec-1',
      title: 'Spec',
    })

    const out = await googleDocsImportService.importGoogleDoc('ws1', 'm1', {
      url: 'https://docs.google.com/document/d/g1/edit',
    })

    expect(documentService.createDocument).toHaveBeenCalledWith(
      'ws1',
      'm1',
      expect.objectContaining({
        title: 'Spec',
        contentMarkdown: '# Spec\n\nbody',
        googleDocId: 'g1',
        googleDocImporterId: 'm1',
      })
    )
    expect(out).toEqual({ id: 'doc1', slug: 'spec-1', title: 'Spec' })
  })
})

describe('resyncGoogleDoc', () => {
  it('throws 400 when the doc has no google source', async () => {
    ;(documentRepository.findSourceMeta as jest.Mock).mockResolvedValue({
      id: 'doc1',
      googleDocId: null,
      googleDocImporterId: null,
    })
    await expect(
      googleDocsImportService.resyncGoogleDoc('ws1', 'm1', 'doc1')
    ).rejects.toThrow(/not a google-imported/i)
  })

  it('re-syncs using the importer token and overwrites the body', async () => {
    ;(documentRepository.findSourceMeta as jest.Mock).mockResolvedValue({
      id: 'doc1',
      googleDocId: 'g1',
      googleDocImporterId: 'importer1',
    })
    fakeClient.exportMarkdown.mockResolvedValue('# Updated')
    ;(documentService.updateDocument as jest.Mock).mockResolvedValue({
      id: 'doc1',
    })

    await googleDocsImportService.resyncGoogleDoc('ws1', 'm1', 'doc1')

    // owner model: client built for the importer, not the acting member
    expect(getClientForMember).toHaveBeenCalledWith('ws1', 'importer1')
    expect(documentService.updateDocument).toHaveBeenCalledWith(
      'doc1',
      'importer1',
      'ws1',
      expect.objectContaining({ contentMarkdown: '# Updated' })
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- google-docs-import.service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

`lib/services/google-docs-import.service.ts`:

```typescript
import { parseGoogleDocId } from '@/lib/integrations/google-drive/parse-url'
import { getClientForMember } from '@/lib/services/google-drive-integration.service'
import { documentService } from '@/lib/services/document.service'
import { documentRepository } from '@/lib/repositories/document.repository'

export const googleDocsImportService = {
  /**
   * Import a Google Doc as a new Lumo Document, recording the acting member as
   * the importer (owner) whose token future syncs reuse. Access is enforced by
   * Google at fetch time via the acting member's token.
   */
  async importGoogleDoc(
    workspaceId: string,
    memberId: string,
    input: { url: string; visibility?: 'PRIVATE' | 'WORKSPACE' | 'SHARED' }
  ) {
    const fileId = parseGoogleDocId(input.url)
    if (!fileId) {
      throw Object.assign(new Error('Not a valid Google Doc URL or id'), {
        status: 400,
      })
    }

    const client = await getClientForMember(workspaceId, memberId)
    const meta = await client.getMetadata(fileId)
    const markdown = await client.exportMarkdown(fileId)

    return documentService.createDocument(workspaceId, memberId, {
      title: meta.name || 'Untitled',
      visibility: input.visibility ?? 'PRIVATE',
      contentMarkdown: markdown,
      googleDocId: fileId,
      googleDocImporterId: memberId,
      googleDocSyncedAt: new Date(),
    })
  },

  /**
   * Re-sync an imported doc: re-export from Google using the IMPORTER's token
   * (owner model) and overwrite the Lumo body. One-way, destructive to local
   * edits by design.
   */
  async resyncGoogleDoc(
    workspaceId: string,
    _actingMemberId: string,
    docId: string
  ) {
    const meta = await documentRepository.findSourceMeta(docId, workspaceId)
    if (!meta || !meta.googleDocId || !meta.googleDocImporterId) {
      throw Object.assign(new Error('Not a Google-imported document'), {
        status: 400,
      })
    }

    const importerId = meta.googleDocImporterId
    try {
      const client = await getClientForMember(workspaceId, importerId)
      const markdown = await client.exportMarkdown(meta.googleDocId)
      // updateDocument runs as the importer so the OWNER permission check passes
      // (the importer is the doc creator). syncedAt set, prior error cleared.
      const updated = await documentService.updateDocument(
        docId,
        importerId,
        workspaceId,
        {
          contentMarkdown: markdown,
          googleDocSyncedAt: new Date(),
          googleDocSyncError: null,
        }
      )
      return updated
    } catch (e) {
      const msg = (e as Error).message.slice(0, 240)
      await documentRepository.update(docId, { googleDocSyncError: msg })
      throw e
    }
  },
}
```

> **Note for the implementer:** `documentService.updateDocument`'s `UpdateDocumentInput` must accept `googleDocSyncedAt` / `googleDocSyncError`. Extend that interface and copy the two fields into `updateData` (next task) — without it the `updateDocument` call above won't compile.

- [ ] **Step 4: Extend `UpdateDocumentInput` + forward in `updateDocument`**

In `lib/services/document.service.ts`, add to `UpdateDocumentInput` (after `childOrder?: string[]`, line 45):

```typescript
  googleDocSyncedAt?: Date | null
  googleDocSyncError?: string | null
```

In `updateDocument`, after the existing `if (data.publicToken !== undefined) ...` block (around line 448), add:

```typescript
if (data.googleDocSyncedAt !== undefined)
  updateData.googleDocSyncedAt = data.googleDocSyncedAt
if (data.googleDocSyncError !== undefined)
  updateData.googleDocSyncError = data.googleDocSyncError
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- google-docs-import.service.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add lib/services/google-docs-import.service.ts lib/services/document.service.ts __tests__/lib/services/google-docs-import.service.test.ts
git commit -m "feat: google docs import + resync service [LUM-127]"
```

### Task 11: Import + sync API routes

**Files:**

- Create: `app/api/documents/import-google/route.ts`
- Create: `app/api/documents/[id]/sync-google/route.ts`
- Test: `__tests__/api/documents-import-google.test.ts` (validation only — mock the service)

- [ ] **Step 1: Write the failing test (Zod validation)**

`__tests__/api/documents-import-google.test.ts`:

```typescript
import { importGoogleSchema } from '@/lib/validation/document'

describe('importGoogleSchema', () => {
  it('requires a non-empty url', () => {
    expect(importGoogleSchema.safeParse({ url: '' }).success).toBe(false)
  })
  it('accepts a url with optional visibility', () => {
    const r = importGoogleSchema.safeParse({
      url: 'https://docs.google.com/document/d/x/edit',
      visibility: 'WORKSPACE',
    })
    expect(r.success).toBe(true)
  })
  it('rejects an unknown visibility', () => {
    expect(
      importGoogleSchema.safeParse({ url: 'x', visibility: 'BOGUS' }).success
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- documents-import-google.test.ts`
Expected: FAIL — `importGoogleSchema` not exported.

- [ ] **Step 3: Add the Zod schema**

In `lib/validation/document.ts` (the per-domain Zod file; if it doesn't exist, create it and export from there), add:

```typescript
import { z } from 'zod'

export const importGoogleSchema = z.object({
  url: z.string().trim().min(1, 'url is required'),
  visibility: z.enum(['PRIVATE', 'WORKSPACE', 'SHARED']).optional(),
})
```

- [ ] **Step 4: Implement `import-google/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { importGoogleSchema } from '@/lib/validation/document'
import { googleDocsImportService } from '@/lib/services/google-docs-import.service'

export async function POST(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const ws = await getUserWorkspace(authResult.userId)
  if (!ws) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const parsed = importGoogleSchema.safeParse(
    await request.json().catch(() => null)
  )
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 }
    )
  }

  try {
    const document = await googleDocsImportService.importGoogleDoc(
      ws.workspaceId,
      ws.member.id,
      parsed.data
    )
    return NextResponse.json({ document })
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500
    return NextResponse.json({ error: (e as Error).message }, { status })
  }
}
```

- [ ] **Step 5: Implement `[id]/sync-google/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { googleDocsImportService } from '@/lib/services/google-docs-import.service'

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const ws = await getUserWorkspace(authResult.userId)
  if (!ws) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const document = await googleDocsImportService.resyncGoogleDoc(
      ws.workspaceId,
      ws.member.id,
      params.id
    )
    return NextResponse.json({ document })
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500
    return NextResponse.json({ error: (e as Error).message }, { status })
  }
}
```

> **Implementer note:** match the App Router `params` typing this codebase uses (sync `{ params: { id: string } }` vs `Promise`-wrapped). Check a sibling route under `app/api/documents/[id]/` and follow it exactly.

- [ ] **Step 6: Run test + typecheck**

Run: `npm test -- documents-import-google.test.ts` → PASS
Run: `npx tsc --noEmit` → no errors

- [ ] **Step 7: Commit**

```bash
git add app/api/documents/import-google/ "app/api/documents/[id]/sync-google/" lib/validation/document.ts __tests__/api/documents-import-google.test.ts
git commit -m "feat: import-google + sync-google API routes [LUM-127]"
```

---

## Phase 3 — CLI

### Task 12: `lumo doc import-gdoc <url>` command

**Files:**

- Create: `cli/src/commands/doc-import-gdoc.ts`
- Modify: `cli/src/index.ts` (register under the `doc` group)
- Test: `__tests__/cli/doc-import-gdoc.test.ts` (pure output formatter + arg handling)

- [ ] **Step 1: Write the failing test (formatter)**

`__tests__/cli/doc-import-gdoc.test.ts`:

```typescript
import { formatImportedLine } from '@/cli/src/commands/doc-import-gdoc'

describe('formatImportedLine', () => {
  it('prints id, title, url and the over-share hint', () => {
    const out = formatImportedLine({
      id: 'cmd_1',
      title: 'Spec',
      url: 'https://www.uselumo.ai/workspace/lumo/documents/spec-1',
    })
    expect(out).toContain('Imported cmd_1 "Spec"')
    expect(out).toContain(
      'https://www.uselumo.ai/workspace/lumo/documents/spec-1'
    )
    expect(out.toLowerCase()).toContain('no longer gated by google')
  })
})
```

> If `@/cli/...` isn't resolvable in the CLI's jest config, use the relative path the other `__tests__/cli/*` files use. Check an existing CLI test import first.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- doc-import-gdoc.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the command (mirror doc-create's credential + URL plumbing)**

`cli/src/commands/doc-import-gdoc.ts`:

```typescript
import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'

export interface ImportGdocOptions {
  scope?: string
  task?: string
}

interface ImportedDocResponse {
  document: { id: string; slug: string; title: string }
}

export function formatImportedLine(doc: {
  id: string
  title: string
  url: string
}): string {
  const escaped = doc.title.replace(/"/g, '\\"')
  return (
    `Imported ${doc.id} "${escaped}"  ${doc.url}\n` +
    `Note: imported content follows Lumo sharing and is no longer gated by Google permissions.`
  )
}

function normalizeScope(
  value: string | undefined
): 'PRIVATE' | 'WORKSPACE' | undefined {
  if (value === undefined) return undefined
  const lower = value.toLowerCase()
  if (lower === 'personal') return 'PRIVATE'
  if (lower === 'workspace') return 'WORKSPACE'
  return undefined
}

export async function docImportGdoc(
  url: string,
  opts: ImportGdocOptions
): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }
  if (!url || url.trim().length === 0) {
    console.error('Error: a Google Doc URL or id is required.')
    return 1
  }

  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl
  const base = trimTrailingSlash(apiUrl)

  const body: Record<string, unknown> = { url: url.trim() }
  const scope = normalizeScope(opts.scope)
  if (scope) body.visibility = scope

  let res: Response
  try {
    res = await fetch(`${base}/api/documents/import-google`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    console.error(`Error: network failure: ${(err as Error).message}`)
    return 1
  }
  if (!res.ok) {
    const text = await res.text()
    console.error(`Error: ${res.status} ${res.statusText}: ${text}`)
    return 1
  }

  const { document } = (await res.json()) as ImportedDocResponse
  const fullUrl = `${base}/workspace/${creds.workspaceSlug ?? 'lumo'}/documents/${document.slug}`
  console.log(
    formatImportedLine({ id: document.id, title: document.title, url: fullUrl })
  )

  if (opts.task) {
    const bindRes = await fetch(
      `${base}/api/documents/${document.id}/mentions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${creds.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ taskIdentifier: opts.task }),
      }
    )
    if (!bindRes.ok) {
      const text = await bindRes.text()
      console.error(
        `Warning: imported but bind to ${opts.task} failed: ${bindRes.status} ${text}`
      )
      return 1
    }
    console.log(`Bound ${document.id} ↔ ${opts.task}`)
  }
}
```

- [ ] **Step 4: Register in `cli/src/index.ts`**

Near the other doc imports (line 55) add:

```typescript
import { docImportGdoc } from './commands/doc-import-gdoc'
```

Under the `const doc = program.command('doc')...` group (after the `create` subcommand registration, ~line 807) add:

```typescript
doc
  .command('import-gdoc')
  .description('Import a Google Doc as a Lumo doc (one-way Google → Lumo)')
  .argument('<url>', 'Google Doc URL or file id')
  .option('--scope <scope>', 'personal | workspace (default personal)')
  .option('--task <LUM-N>', 'bind the imported doc to this task')
  .action((url, opts) =>
    docImportGdoc(url as string, opts as ImportGdocOptions)
  )
```

Add the `ImportGdocOptions` type import alongside the function import if your lint requires it, or inline the type.

- [ ] **Step 5: Run test + build CLI**

Run: `npm test -- doc-import-gdoc.test.ts` → PASS
Run: `cd cli && npm run build` (or the CLI's typecheck script) → no errors

- [ ] **Step 6: Commit**

```bash
git add cli/src/commands/doc-import-gdoc.ts cli/src/index.ts __tests__/cli/doc-import-gdoc.test.ts
git commit -m "feat: lumo doc import-gdoc command [LUM-127]"
```

### Task 13: `lumo doc sync <doc>` command

**Files:**

- Create: `cli/src/commands/doc-sync.ts`
- Modify: `cli/src/index.ts`
- Test: `__tests__/cli/doc-sync.test.ts`

- [ ] **Step 1: Write the failing test (formatter)**

`__tests__/cli/doc-sync.test.ts`:

```typescript
import { formatSyncedLine } from '@/cli/src/commands/doc-sync'

describe('formatSyncedLine', () => {
  it('reports the synced doc', () => {
    expect(formatSyncedLine({ id: 'cmd_1', title: 'Spec' })).toBe(
      'Synced cmd_1 "Spec" from Google'
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- doc-sync.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `doc-sync.ts`**

`cli/src/commands/doc-sync.ts`:

```typescript
import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'
import { lookupDocId } from '../lib/resolve-doc-id'

interface SyncedDocResponse {
  document: { id: string; title: string }
}

export function formatSyncedLine(doc: { id: string; title: string }): string {
  const escaped = doc.title.replace(/"/g, '\\"')
  return `Synced ${doc.id} "${escaped}" from Google`
}

export async function docSync(reference: string): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }

  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl
  const base = trimTrailingSlash(apiUrl)

  const docId = await lookupDocId(apiUrl, creds.token, reference)
  if (!docId) {
    console.error(`Error: doc not found: ${reference}`)
    return 1
  }

  let res: Response
  try {
    res = await fetch(`${base}/api/documents/${docId}/sync-google`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${creds.token}` },
    })
  } catch (err) {
    console.error(`Error: network failure: ${(err as Error).message}`)
    return 1
  }
  if (!res.ok) {
    const text = await res.text()
    console.error(`Error: ${res.status} ${res.statusText}: ${text}`)
    return 1
  }

  const { document } = (await res.json()) as SyncedDocResponse
  console.log(formatSyncedLine(document))
}
```

- [ ] **Step 4: Register in `cli/src/index.ts`**

Add import near line 55:

```typescript
import { docSync } from './commands/doc-sync'
```

Under the `doc` group:

```typescript
doc
  .command('sync')
  .description('Re-sync a Google-imported doc (overwrites the Lumo body)')
  .argument('<doc>', 'doc cuid or title')
  .action(ref => docSync(ref as string))
```

- [ ] **Step 5: Run test + build CLI**

Run: `npm test -- doc-sync.test.ts` → PASS
Run: `cd cli && npm run build` → no errors

- [ ] **Step 6: Commit**

```bash
git add cli/src/commands/doc-sync.ts cli/src/index.ts __tests__/cli/doc-sync.test.ts
git commit -m "feat: lumo doc sync command [LUM-127]"
```

---

## Phase 4 — UI + docs

### Task 14: Settings integration card

**Files:**

- Create: `app/workspace/[workspaceUrl]/hooks/useGoogleDriveIntegration.ts`
- Create: `app/workspace/[workspaceUrl]/components/GoogleDriveIntegrationCard.tsx`
- Modify: `app/workspace/[workspaceUrl]/constants.ts` (add `API.googleDrive`)
- Modify: `app/workspace/[workspaceUrl]/components/pages/IntegrationsPage.tsx` (render the card)
- Test: none (UI parity with Figma; verified manually in Task 16). Note the memory: client components must NOT import server-only integration barrels — this card only calls API routes via the hook, so it stays clean.

- [ ] **Step 1: Add `API.googleDrive` URL helpers**

In `app/workspace/[workspaceUrl]/constants.ts`, next to the `figma` block (the file already has `API.figma.oauth(workspaceUrl)`), add a parallel block:

```typescript
  googleDrive: {
    oauth: (workspaceUrl: string) =>
      `/api/google-drive/oauth?workspaceUrl=${encodeURIComponent(workspaceUrl)}`,
    status: '/api/google-drive/status',
    disconnect: '/api/google-drive',
  },
```

- [ ] **Step 2: Implement the hook**

Open `app/workspace/[workspaceUrl]/hooks/useFigmaIntegration.ts`, copy it to `useGoogleDriveIntegration.ts`, and adapt: rename the export to `useGoogleDriveIntegration`, point the status fetch at `API.googleDrive.status`, the disconnect call at `DELETE API.googleDrive.disconnect`, and shape the returned `status` as `{ connected: boolean; email: string | null; needsReauth: boolean }`. Keep the same `loading` / `disconnectOpen` / `setDisconnectOpen` / `disconnecting` / `handleDisconnect` surface so the card mirrors `FigmaIntegrationCard`.

- [ ] **Step 3: Implement the card**

Copy `app/workspace/[workspaceUrl]/components/FigmaIntegrationCard.tsx` to `GoogleDriveIntegrationCard.tsx` and adapt:

- export `GoogleDriveIntegrationCard`
- use `useGoogleDriveIntegration()`
- swap the icon for a Google Drive glyph. If there's no existing brand icon component, use a `lucide-react` `HardDrive` icon to avoid adding a dependency; if you add a real brand SVG, run `npm run lint:tokens -- --update` and stage the baseline (see the brand-color token memory).
- replace all `figma.*` intl ids with `googleDrive.*` (added in Task 15)
- the connected line shows `status?.email` instead of `@handle`
- the connect link is `API.googleDrive.oauth(workspaceUrl)`

- [ ] **Step 4: Render the card on the integrations page**

In `app/workspace/[workspaceUrl]/components/pages/IntegrationsPage.tsx`, import `GoogleDriveIntegrationCard` and render it alongside `FigmaIntegrationCard` in the same list/grid.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (Will fail until Task 15 adds the i18n keys if your intl is type-checked — run Task 15 first if so.)

- [ ] **Step 6: Commit**

```bash
git add "app/workspace/[workspaceUrl]/hooks/useGoogleDriveIntegration.ts" "app/workspace/[workspaceUrl]/components/GoogleDriveIntegrationCard.tsx" "app/workspace/[workspaceUrl]/constants.ts" "app/workspace/[workspaceUrl]/components/pages/IntegrationsPage.tsx"
git commit -m "feat: google drive settings integration card [LUM-127]"
```

### Task 15: i18n keys (every locale)

**Files:**

- Modify: every file in `lib/i18n/*.json`

- [ ] **Step 1: List the locale files**

Run: `ls lib/i18n/*.json`
Expected: a set like `en.json`, `zh-CN.json`, plus others. Per CLAUDE.md you must update **every** one with a proper translation — never English fallback for non-English.

- [ ] **Step 2: Add the `googleDrive.*` keys to each locale**

Mirror the existing `figma.*` keys. The required keys (match whatever the card actually references):

```
googleDrive.title
googleDrive.description
googleDrive.connectGoogle
googleDrive.connected
googleDrive.connectedAs
googleDrive.reauthRequired
googleDrive.reconnect
googleDrive.disconnect
googleDrive.disconnectConfirmTitle
googleDrive.disconnectConfirmBody
```

For `en.json` use natural English; for `zh-CN.json` use natural Chinese (e.g. `"googleDrive.title": "Google Drive"`, `"googleDrive.connectGoogle": "连接 Google"`, `"googleDrive.connected": "已连接"`); provide a proper translation for each other locale present.

- [ ] **Step 3: Verify all locales have the keys**

Run: `node -e "const fs=require('fs');for(const f of fs.readdirSync('lib/i18n').filter(x=>x.endsWith('.json'))){const j=JSON.parse(fs.readFileSync('lib/i18n/'+f));if(!j['googleDrive.title'])throw new Error('missing in '+f);}console.log('all locales ok')"`
Expected: `all locales ok`.

- [ ] **Step 4: Typecheck + commit**

Run: `npx tsc --noEmit` → no errors

```bash
git add lib/i18n/
git commit -m "feat: i18n keys for google drive integration [LUM-127]"
```

### Task 16: SKILL.md sync + manual verification + .env.example

**Files:**

- Modify: `.claude/skills/lumo/SKILL.md`
- Modify: `.env.example`

- [ ] **Step 1: Document the two new CLI subcommands in SKILL.md**

Per CLAUDE.md ("CLI & Skills 同步"), add to the Document Management section of `.claude/skills/lumo/SKILL.md`:

- a `### lumo doc import-gdoc <url> [--scope] [--task]` subsection describing the one-way import, the over-share note, and an example
- a `### lumo doc sync <doc>` subsection describing the destructive one-way re-sync (overwrites the Lumo body), who the sync runs as (the importer), and an example
- update the front-matter `description` trigger words to include "import google doc", "sync google doc", "google drive"

- [ ] **Step 2: Add env vars to `.env.example`**

Append:

```
# Google Drive integration (LUM-127) — per-user OAuth for importing Google Docs
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=
```

- [ ] **Step 3: Full test suite + typecheck**

Run: `npm test` → all green
Run: `npx tsc --noEmit` → no errors
Run: `npm run lint` (and `npm run lint:tokens` if a brand icon was added)

- [ ] **Step 4: Manual end-to-end verification (requires real Google OAuth app credentials in `.env.local`)**

1. `npm run dev`, open `/workspace/lumo/settings/integrations`, click Connect Google, approve, confirm the card shows connected + your email.
2. `lumo doc import-gdoc "https://docs.google.com/document/d/<id>/edit" --task LUM-127` — confirm `Imported ...` + the over-share note + `Bound ... ↔ LUM-127`.
3. `lumo task context LUM-127` — confirm the imported doc shows up in the Documents section.
4. Edit the Google Doc, then `lumo doc sync <doc-id>` — confirm `Synced ...` and that `lumo doc show <doc-id>` reflects the new content.
5. (Owner model) From a second member who can't access the Google Doc, `lumo doc sync <doc-id>` should still succeed (uses importer token); a member syncing a doc whose importer lost access should get a clear error.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/lumo/SKILL.md .env.example
git commit -m "docs: document google doc import/sync CLI + env vars [LUM-127]"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** OAuth connect (Tasks 2,6,7,14,15) ✓; per-user token storage encrypted (Tasks 1,5,6) ✓; importer-owner re-sync (Task 10) ✓; one-way overwrite (Task 10 uses `updateDocument` contentMarkdown) ✓; Drive export → markdown (Task 4) ✓; source fields on Document not a new table (Tasks 1,8,9) ✓; bind to task reuses existing mentions (Task 12 `--task`) ✓; doc-in-context reuses existing rendering (no task needed — confirmed by exploration) ✓; over-share hint at import (Task 12 formatter) ✓; CLI import + sync (Tasks 12,13) ✓; SKILL.md sync (Task 16) ✓; i18n every locale (Task 15) ✓; manual one-click, no polling (no cron task added) ✓.
- **Type consistency:** `googleDocId` / `googleDocImporterId` / `googleDocSyncedAt` / `googleDocSyncError` used identically across schema (Task 1), repo (Task 8), service create (Task 9) and update (Task 10). Client methods `getMetadata` / `exportMarkdown` consistent across Tasks 4 and 10. `getClientForMember(workspaceId, memberId)` signature consistent across Tasks 6 and 10.
- **Known follow-ups (out of scope, leave as future tasks):** background/scheduled auto-sync; two-way sync; over-share ACL validation; markdown fidelity hardening for tables/images (Drive's native markdown export handles headings/lists/tables reasonably but image handling is lossy — note this in the PR).

## Open items the implementer must confirm against the codebase (not guesses)

1. The exact App Router `params` typing for `app/api/documents/[id]/*` (sync object vs `Promise`) — copy a sibling route.
2. Whether `lib/validation/document.ts` already exists; if Zod schemas for documents live elsewhere, put `importGoogleSchema` next to them.
3. The CLI jest import alias (`@/cli/...` vs relative) used by existing `__tests__/cli/*` tests.
4. The real shape of `useFigmaIntegration` before copying it (status field names) and the IntegrationsPage layout.
