# Figma Task Context Design

**Task**: [LUM-104](https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-104)
**Date**: 2026-05-28
**Status**: Draft

## Summary

Allow workspace members to attach Figma file / frame URLs to a Task. Each link
carries structured metadata (file name, frame name, thumbnail) fetched from the
Figma API via per-member OAuth, and renders as a dedicated "Figma Designs"
section in `lumo task context <id>`. This gives the agent first-class visibility
into design references when loading a task.

## Goals

- Attach Figma URLs to a Task via CLI: `lumo task figma add <task> <url>`.
- Surface frame name + file name + thumbnail URL in agent-facing task context.
- Manual refresh via `lumo task figma refresh <task>` for design changes.
- Lazy refresh of stale thumbnails (Figma thumbnail URLs expire ~30 days).
- Per-member Figma OAuth, mirroring the existing GitHub integration pattern.

## Non-goals (v1)

- Figma webhook integration (no design-update push).
- Storing thumbnails in S3 — link directly to Figma's CDN URL.
- Background cron for batch thumbnail refresh — lazy + manual covers v1.
- Workspace-level PAT fallback for users without personal Figma accounts.
- Comment / sub-task level attachment granularity (task-level only).
- `lumo figma auth login/logout/status` CLI (OAuth lives in Web UI).
- `lumo task figma open` — `lumo task show` already prints clickable URLs.
- Single-link refresh (`refresh <link-id>`) — task-level fanout only.
- Writing comments / posting back to Figma — `files:read` scope only.

## §1 Architecture overview

```
                       ┌──────────────────────────┐
  Web UI / CLI ───────▶│  /api/tasks/[id]/figma   │ (REST: GET/POST/DELETE)
                       └────────────┬─────────────┘
                                    │
                                    ▼
                     ┌──────────────────────────────┐
                     │ taskFigmaLinkService         │  ← Service layer
                     │  - addFigmaLink(taskId, url) │    parse URL, call Figma API, write DB
                     │  - listForTask(taskId)       │
                     │  - removeFigmaLink(id)       │
                     │  - refreshLinksForTask(id)   │
                     └────┬─────────────────────┬───┘
                          │                     │
                          ▼                     ▼
         ┌──────────────────────────┐   ┌───────────────────────────┐
         │ taskFigmaLinkRepository  │   │ lib/integrations/figma/   │
         │ Prisma CRUD over         │   │  - oauth.ts (auth flow)   │
         │ TaskFigmaLink            │   │  - client.ts (REST calls) │
         └──────────────────────────┘   │  - parse-url.ts           │
                                        │  - token.ts (encrypt/dec) │
                                        └───────────────────────────┘
                                                  │
                                                  ▼
                                       ┌──────────────────────────┐
                                       │ FigmaIntegration (Prisma)│
                                       │ (workspaceId, memberId)  │
                                       │ access/refresh, encrypted│
                                       └──────────────────────────┘
```

Data flow: `CLI / UI → API Route → Service → Repository → Prisma/DB`. OAuth
and HTTP client centralized in `lib/integrations/figma/`, mirroring `slack/`
and `github/`.

**Layered architecture compliance**

- API routes are thin (~50–100 lines): auth → Zod validate → service → response.
- Services do not touch Prisma directly; they go through the repository.
- Repositories contain no business logic, no permission checks, no Figma API
  calls.

## §2 Data model

Two new Prisma models:

```prisma
model FigmaIntegration {
  id            String   @id @default(cuid())
  workspaceId   String
  memberId      String
  accessToken   String   // AES-256-GCM encrypted: "iv:authTag:ciphertext" (hex)
  refreshToken  String   // same encryption
  expiresAt     DateTime // OAuth access token expiry
  figmaUserId   String
  figmaHandle   String   // display handle (e.g. "chao.li")
  figmaEmail    String?
  scopes        String[] // ["files:read"] etc.
  needsReauth   Boolean  @default(false) // set when refresh fails
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  workspace     Workspace       @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  member        WorkspaceMember @relation(fields: [memberId], references: [id], onDelete: Cascade)
  figmaLinks    TaskFigmaLink[]

  @@unique([workspaceId, memberId])
  @@index([workspaceId])
  @@map("figma_integrations")
}

model TaskFigmaLink {
  id                 String   @id @default(cuid())
  taskId             String
  workspaceId        String   // denormalized for workspace-scoped queries
  createdById        String   // WorkspaceMember.id
  integrationId      String?  // which member's OAuth fetched metadata (for refresh attribution)

  url                String   // normalized full URL (includes node-id)
  fileKey            String   // parsed from URL
  nodeId             String   // parsed from URL ?node-id=; "" = whole file (sentinel, see below)
  fileName           String   // GET /v1/files/:key → name
  frameName          String?  // when nodeId != "", the node's name; null for file-level
  thumbnailUrl       String?  // GET /v1/images/:key?ids=... — temporary URL
  thumbnailFetchedAt DateTime? // for staleness check (Figma URLs ~30d TTL)
  lastSyncedAt       DateTime @default(now())
  lastSyncError      String?  // short reason of most-recent refresh failure

  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  task        Task              @relation(fields: [taskId], references: [id], onDelete: Cascade)
  workspace   Workspace         @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  createdBy   WorkspaceMember   @relation(fields: [createdById], references: [id], onDelete: Restrict)
  integration FigmaIntegration? @relation(fields: [integrationId], references: [id], onDelete: SetNull)

  @@unique([taskId, fileKey, nodeId])  // no duplicate frames on the same task
  @@index([taskId])
  @@index([workspaceId])
  @@map("task_figma_links")
}
```

**Design notes**

- `(taskId, fileKey, nodeId)` uniqueness: a task can hold many frames from the
  same file but never the same frame twice. File-level links use the sentinel
  `nodeId = ""` (empty string) rather than `NULL`. Reason: on Postgres,
  `NULL ≠ NULL` in a compound unique constraint — `@@unique([... nodeId])` with
  a nullable column would _not_ prevent two file-level rows for the same task,
  defeating the purpose. Storing `""` for file-level gives clean Prisma-native
  uniqueness without manual partial-index SQL.
- `integrationId` is soft-referenced (`onDelete: SetNull`): if the creating
  member leaves, the link survives — only thumbnails go stale until any other
  member with a Figma integration refreshes.
- `fileName` is duplicated across rows referencing the same file. Acceptable
  redundancy; avoids a `FigmaFile` table whose only payload would be a name.
- No `pageName`, no node tree caching — kept minimal to limit Figma API load.

**Migration**

- Additive only: two new tables, no backfill, no destructive changes.
- Production path: standard `prisma migrate deploy` on next deploy. PR description
  must call this out per CLAUDE.md.

## §3 OAuth flow

Web-only OAuth — CLI does not embed the auth flow.

**New files**

| Path                                                   | Responsibility                                                               |
| ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `app/api/integrations/figma/connect/route.ts`          | GET: generate signed state, redirect to `https://www.figma.com/oauth?...`    |
| `app/api/integrations/figma/callback/route.ts`         | GET: exchange code → tokens, encrypt, upsert FigmaIntegration                |
| `app/api/integrations/figma/disconnect/route.ts`       | POST: delete FigmaIntegration                                                |
| `app/(workspace)/settings/integrations/figma/page.tsx` | UI: connection status + Connect/Disconnect buttons                           |
| `lib/integrations/figma/oauth.ts`                      | `getAuthorizeUrl()` / `exchangeCode()` / `refreshAccessToken()`              |
| `lib/integrations/figma/token.ts`                      | encrypt/decrypt (reuses `lib/crypto/aes-gcm.ts`)                             |
| `lib/integrations/figma/client.ts`                     | `getFile(fileKey)` / `getImage(fileKey, ids[])`; auto-refresh expired tokens |

**Token auto-refresh** — `client.ts` checks `expiresAt` before each call; if
within 60s of expiry, refreshes synchronously. If refresh fails (e.g. user
revoked from Figma side), set `needsReauth = true` on the integration and
surface to callers as a 403 with `code: 'figma_needs_reauth'`.

**Environment variables**

- `FIGMA_OAUTH_CLIENT_ID`
- `FIGMA_OAUTH_CLIENT_SECRET`
- `FIGMA_OAUTH_REDIRECT_URI`

Configured in Vercel. Documented in code, not the CLI README (per the
project's "advanced env vars don't go in CLI front-door README" convention).

**CLI not-connected path**

When `addFigmaLink` / `refreshLinksForTask` runs without an integration:

```
✗ You haven't connected Figma yet.
  Run: open https://www.uselumo.ai/settings/integrations/figma
```

**Scope** — v1 requests `files:read` only.

**Security**

- State token is a signed JWT (10 min TTL) — CSRF defense.
- Access + refresh tokens AES-256-GCM encrypted before DB write, same scheme
  as GitHub integration.
- Workspace isolation: `(workspaceId, memberId)` unique — connecting Figma in
  workspace A does not carry to workspace B.

## §4 URL parsing & Figma API

**Supported URL shapes**

```
https://www.figma.com/file/<fileKey>/<slug>                     → whole file
https://www.figma.com/file/<fileKey>/<slug>?node-id=123-456     → specific frame
https://www.figma.com/design/<fileKey>/<slug>?node-id=...       → new URL (2024+, equivalent)
https://www.figma.com/proto/<fileKey>/<slug>?node-id=...        → prototype, treated as frame
```

`lib/integrations/figma/parse-url.ts`:

```ts
parseFigmaUrl(input: string): { fileKey: string; nodeId: string | null } | null
```

- Unknown URLs (non-figma.com host, missing fileKey) → return `null`; service
  responds 422 "Not a Figma URL".
- Node ID normalization: URLs use `123-456` or `123%3A456`; the Figma API
  requires `123:456`. Normalize to colon form when storing.

**`addFigmaLink` flow** (inside service)

```
1. parseFigmaUrl(url) → { fileKey, nodeId | null }
2. GET /v1/files/:fileKey?depth=1
     → fileName = response.name
     → if parsed nodeId is null:
         pick representativeNodeId = first FRAME child of first CANVAS in response.document
         (used only for the thumbnail call below; not persisted)
3. if parsed nodeId is non-null:
     GET /v1/files/:fileKey/nodes?ids=:nodeId
     → frameName = response.nodes[nodeId].document.name
   else:
     frameName = null  (file-level rows do not store a frame name)
4. GET /v1/images/:fileKey?ids=<nodeId or representativeNodeId>&format=png&scale=2
     → thumbnailUrl, record thumbnailFetchedAt
5. UPSERT TaskFigmaLink with:
     nodeId      = parsed nodeId, or "" sentinel for file-level
     frameName   = from step 3, or null for file-level
     thumbnailUrl = from step 4
```

When the URL is file-level (`nodeId = ""`), the picked-frame's name is shown
in the `add` command's CLI output as a decoration only — it is **not**
persisted. A subsequent `refresh` re-picks from scratch; if the user
reorders frames in Figma, the thumbnail may shift to a different frame
between refreshes. This is intentional: file-level semantics stay file-level
in the data model.

`depth=1` avoids pulling the full node tree; file-level fields are all we need.

**Failure handling**

| Condition                                           | Behavior                                                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Figma API 4xx (token invalid after refresh attempt) | Mark `needsReauth`, return 403 to caller. **Do not write to DB.**                                                                    |
| Figma API 404 (file deleted / no access)            | Return 422 "File not accessible". **Do not write to DB.**                                                                            |
| File + node OK but image API fails                  | **Write row** with `thumbnailUrl = null`, `lastSyncError = 'thumbnail_failed'`. Frame info is useful; thumbnail can be filled later. |

**Lazy refresh** (v1's only background path)

`task figma list` and `task context` walk the result; for any row where
`thumbnailFetchedAt IS NULL` or `thumbnailFetchedAt > 25 days ago`, enqueue
an async refresh via `waitUntil()` (per the `task-state.service.ts`
convention). Does not block the response. The current response uses the
stale (or missing) URL; the next access sees fresh data.

**Idempotency window for `addFigmaLink`**

When a row already exists for `(taskId, fileKey, nodeId)` and `lastSyncedAt`
is within 7 days, `addFigmaLink` skips the Figma API and returns the existing
row with an "Already linked" message. Beyond 7 days, the existing row gets a
forced re-sync as part of the add call. 7 days is chosen as a balance:
shorter than the 25-day thumbnail-stale threshold (so re-adding is a quick
refresh path) but long enough to avoid hammering Figma when users re-paste
the same link.

**Rate limiting** — Figma's limits are generous (hundreds per minute). Single
`add` calls 3 endpoints; no client-side throttling needed.

## §5 CLI surface

Four subcommands in `cli/src/commands/task-figma-*.ts`:

### `lumo task figma add <task> <url>`

```
$ lumo task figma add LUM-42 "https://www.figma.com/design/abc123/Onboarding?node-id=1-234"
Linked LUM-42 ↔ Figma "Onboarding · Welcome screen"
  https://www.figma.com/design/abc123/Onboarding?node-id=1-234
```

- No flags — URL is positional and required.
- If URL omits `node-id`, stored as file-level (`nodeId = ""`). The service
  picks a representative frame for the thumbnail call only; the CLI appends
  ` (file-level, thumbnail from "<picked frame name>")` to the output.
- Idempotent: same `(task, fileKey, nodeId)` already attached and
  `lastSyncedAt` < 7 days old → returns 200 with `Already linked LUM-42 ↔ ...`,
  no Figma API re-fetch. Beyond 7 days, the existing row is force-refreshed.

### `lumo task figma list <task>`

Fixed-width rows, same style as `lumo doc list` / `task list`:

```
$ lumo task figma list LUM-42
<id>      <file>           <frame>              <synced>
cfl_xxx1  Onboarding       Welcome screen       2026-05-28
cfl_xxx2  Design System    Button / Primary     2026-05-27
cfl_xxx3  Onboarding       (file-level)         2026-05-20  ⚠ thumbnail stale
```

`⚠ thumbnail stale` shown when `thumbnailFetchedAt > 25 days`.

### `lumo task figma rm <task> <link-id-or-url>`

`<link-id-or-url>` accepts a `cfl_*` cuid or the original URL (URL → parse →
match `(fileKey, nodeId)`).

```
$ lumo task figma rm LUM-42 cfl_xxx1
Removed Figma link from LUM-42: "Onboarding · Welcome screen"
```

No `--yes` flag: a single link is cheap to re-add. Unmatched input prints
`Not linked: <input>` and exits 0 (idempotent, matches `sprint remove`).

### `lumo task figma refresh <task>`

```
$ lumo task figma refresh LUM-42
Refreshed 3 Figma links on LUM-42
  ✓ Onboarding · Welcome screen
  ✓ Onboarding · Sign-up form
  ✗ Design System · Button (file not accessible)
```

- Task-level fanout. Service does parallel API calls; per-link errors are
  isolated, no overall rollback.
- Single-link refresh granularity is intentionally not provided. To refresh
  one specific link, `rm` + `add` is two commands.

### SKILL.md sync

Per CLAUDE.md mandate, `.claude/skills/lumo/SKILL.md` gets:

- A new section: `### lumo task figma {add|list|rm|refresh}` with examples.
- New trigger keywords in frontmatter `description`: `figma`, `attach figma`,
  `figma link`, `关联 figma`, `设计稿`.

## §6 Task context rendering

`lib/services/task-context.service.ts` gains a renderer alongside
`renderWebLinkSection`:

```ts
renderFigmaSection(figmaLinks: TaskFigmaLink[]): string
```

Output (embedded in the `lumo task context LUM-42` markdown stream):

```markdown
## Figma Designs

- **Onboarding · Welcome screen**
  - URL: https://www.figma.com/design/abc123/Onboarding?node-id=1-234
  - Thumbnail: ![](https://figma-alpha-api.s3.amazonaws.com/images/abc-def-123.png)
  - Last synced: 2026-05-28

- **Onboarding · Sign-up form**
  - URL: https://www.figma.com/design/abc123/Onboarding?node-id=1-456
  - Thumbnail: ![](https://figma-alpha-api.s3.amazonaws.com/images/abc-def-456.png)
  - Last synced: 2026-05-28

- **Design System** _(file-level)_
  - URL: https://www.figma.com/design/xyz789/Design-System
  - Thumbnail unavailable _(sync failed: file not accessible)_
  - Last synced: 2026-05-20
```

- **Sort order**: `createdAt` ascending — match existing web-link section.
- **Section placement**: after web-link section, before prior sessions. Agent
  priority becomes: base description → memory → external refs (web links +
  Figma designs) → session history.
- **Lazy refresh trigger**: `taskContextService.getContextForIdentifier()`
  iterates loaded `figmaLinks`; any row where `thumbnailFetchedAt` is null
  or older than 25 days enqueues a refresh via `waitUntil()`. Does not await;
  does not change the current response payload.
- **Empty set**: section is omitted entirely when the task has no links
  (matches `renderWebLinkSection`).
- **API response shape**: `/api/tasks/context/[identifier]` adds
  `figmaSection: string` (pre-rendered markdown). CLI's
  `TaskContextResponse` interface and renderer add the field in order.
- **`lumo task show` is not changed**: `show` lists base task fields; Figma
  links live in `context`. Matches the existing "show for humans, context for
  agents" split that web-links use.

## §7 Testing & verification

Per CLAUDE.md: "Every new function needs at least one test." Jest is the
configured framework.

### Unit tests

| File                                                 | Coverage                                                                                                                |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `__tests__/lib/integrations/figma/parse-url.test.ts` | All four URL shapes parse; `%3A` / `-` in node-id normalize to `:`; invalid URLs return `null`                          |
| `__tests__/lib/integrations/figma/token.test.ts`     | encrypt/decrypt round-trip; ciphertext format `iv:authTag:ciphertext`                                                   |
| `__tests__/lib/integrations/figma/oauth.test.ts`     | `getAuthorizeUrl` includes correct scope + state; `exchangeCode` handles 200 / 400; `refreshAccessToken` handles expiry |
| `__tests__/lib/integrations/figma/client.test.ts`    | `getFile` / `getImage` hit correct endpoint; 401 triggers auto-refresh + single retry; second 401 throws `needsReauth`  |

### Service tests (mock repository + integrations)

`__tests__/lib/services/task-figma-link.service.test.ts`:

- `addFigmaLink` happy path with `?node-id=...`: parse → file → node → image → upsert, returns new row with `frameName` set
- `addFigmaLink` happy path without `node-id` (file-level): row stored with
  `nodeId = ""`, `frameName = null`, thumbnail fetched from picked representative
  frame; same URL re-added does not create a second row (uniqueness on `""`)
- `addFigmaLink` idempotency: same `(taskId, fileKey, nodeId)` with `lastSyncedAt`
  < 7 days → no Figma API calls, returns existing row
- `addFigmaLink` forced refresh: same row, `lastSyncedAt` > 7 days → re-fetches
  metadata and updates the row in place
- `addFigmaLink` without integration → throws `{ status: 403, code: 'figma_not_connected' }`
- `addFigmaLink` with file 404 → throws `{ status: 422 }`, no DB write
- `addFigmaLink` with file/node OK but thumbnail fail → DB write with
  `thumbnailUrl = null`, `lastSyncError = 'thumbnail_failed'`
- `refreshLinksForTask` parallel fanout, per-link error isolation, returns
  per-link results
- `removeFigmaLink` accepts both cuid and URL input forms
- `listForTask` returns rows in `createdAt` ascending order

### Repository test

`__tests__/lib/repositories/task-figma-link.repository.test.ts`: thin layer —
verify the `(taskId, fileKey, nodeId)` unique constraint holds; cascade
behavior (task delete → link delete; integration delete → link
`integrationId` nullified).

### API route tests

`__tests__/app/api/tasks/[id]/figma/route.test.ts`:

- POST unauthenticated → 401
- POST as non-member of task's workspace → 403
- POST missing `url` body → 422 Zod failure
- POST happy path → service called, returns 201
- GET list → 200 with array
- DELETE of nonexistent link → 200 idempotent

### Migration verification

- Local: `npx prisma migrate dev` applies the new migration, all tests pass.
- PR description must include: "requires `migrate deploy` on next deploy; no
  backfill; no data deletion" (per CLAUDE.md schema-change PR convention).

### Manual verification (not automated)

- Web UI: `/settings/integrations/figma` Connect → Figma authorize page → callback
  succeeds → UI shows "Connected as @chao.li".
- Real Figma file URL: `lumo task figma add LUM-104 <url>` → output includes
  frame name → `lumo task context LUM-104` shows the new section with thumbnail
  Markdown.
- Disconnect → `lumo task figma refresh LUM-104` → reports `needsReauth` for
  all links.

### Out of scope for testing (v1)

- Figma webhooks (not integrated in v1).
- S3 thumbnail caching (v1 links directly to figma-alpha-api.s3.amazonaws.com).
- Rate-limit stress testing (Figma quota is well above expected load).

## Open questions

None remaining. All design decisions captured above. Implementation plan
proceeds in a separate spec → plan → execute cycle.
