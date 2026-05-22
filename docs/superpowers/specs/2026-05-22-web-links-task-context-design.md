# Web Links as Task Context — Design

**Task**: LUM-47
**Status**: Spec
**Date**: 2026-05-22

## Goal

Let users attach arbitrary web URLs to a task as first-class context. Each link is stored independently, fetched once for OpenGraph metadata (title, description, image, favicon), rendered as a card in the task detail Timeline, and surfaced in `lumo task context <id>` output so agents see it during work sessions.

Closely mirrors the existing `TaskSlackContext` feature (shipped 2026-05-19): same shape, same flow, generalized to any HTTP(S) URL instead of Slack permalinks.

## Non-Goals (v1)

- CLI subcommand surface (`lumo task link add/list/remove`). Web-only management.
- Full-page content extraction / readability parsing. Only OG/standard HTML meta tags.
- Asynchronous metadata fetching (no background queue / cron).
- Editing existing links. Delete + re-add only.
- Drag-to-reorder links. Sorted by `createdAt desc`.
- Link search / filtering.
- Duplicate URL detection or auto-merge — same URL may be added multiple times within a task.
- Batch import.

## Approach Selected

**Approach A — fully mirror `TaskSlackContext`.** A dedicated `TaskWebLink` model, repository, service, API routes, and UI section. Rejected: a multi-kind `TaskContextLink` table (premature unification, doubles scope by migrating Slack), and reusing `Task.description` markdown (couples context items to body, makes per-item refresh/delete impossible).

## Architecture

```
Component (WebLinkSection / WebLinkCard / WebLinkAddDialog)
  → API Client (lib/api-client/task-web-links.ts)
  → API Route (app/api/tasks/[id]/web-links/...)
  → Service (lib/services/task-web-link.service.ts)
  → OG fetcher (lib/integrations/og-metadata/)
  → Repository (lib/repositories/task-web-link.repository.ts)
  → Prisma
```

Layer responsibilities follow the project's existing contract (see `CLAUDE.md` — Layered Architecture).

`lib/integrations/og-metadata/` is an external network integration. Per the project's RSC-boundary rule, server-side consumers (service) import from submodule paths (`lib/integrations/og-metadata/fetch`), never from the barrel.

## Data Model

```prisma
model TaskWebLink {
  id            String   @id @default(cuid())
  taskId        String
  task          Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)
  url           String                 // normalized: lowercase scheme/host, fragment stripped
  domain        String                 // derived; useful for UI display + indexing
  title         String?                // fetched: og:title || <title>
  description   String?                // fetched: og:description || <meta name="description">
  note          String?                // user-supplied note from the Add dialog
  imageUrl      String?
  faviconUrl    String?
  fetchedAt     DateTime?              // last successful OG fetch; null = never succeeded
  fetchError    String?                // short reason string when last fetch failed
  createdById   String
  createdBy     User     @relation(fields: [createdById], references: [id])
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([taskId, createdAt])
}
```

Add `webLinks TaskWebLink[]` to the `Task` model.

**`description` vs `note`** — two distinct concepts, kept in separate columns to avoid coupling refresh semantics to user input:

- `description` is what the fetcher pulled from `og:description` / `<meta name="description">`. Owned by the fetcher; **refresh overwrites it**.
- `note` is what the user typed in the Add dialog's "Notes (optional)" field. User-owned; **refresh never touches it**.

UI display rule: show `note` if present, fall back to `description`. Card never shows both — keeps the card compact and avoids confusion about which is which.

**Why no JSON snapshot column** (unlike `TaskSlackContext`): OG metadata is a small, flat set of fields that map cleanly to columns. Slack stores raw message bodies (rich/structured), so it needs JSON. We don't.

**URL normalization**:

- `trim()`
- lowercase scheme (`HTTPS` → `https`)
- lowercase host (`Example.COM` → `example.com`)
- strip fragment (`#section` removed)
- preserve path, query, port

`domain` is derived from `new URL(normalized).hostname`.

**Allowed URL schemes**: `http://` and `https://` only. `javascript:`, `data:`, `file:`, etc. rejected at the validation layer. Slack URLs go through `TaskSlackContext`, not here.

## Validation

`lib/validation/task-web-link.ts`:

```ts
export const createWebLinkSchema = z.object({
  url: z
    .string()
    .url()
    .max(2048)
    .refine(u => {
      const parsed = new URL(u)
      return parsed.protocol === 'http:' || parsed.protocol === 'https:'
    }, 'Only http/https URLs are supported'),
  note: z.string().max(500).optional(),
})
```

## API Endpoints

| Method   | Path                                         | Body             | Returns                                                                 |
| -------- | -------------------------------------------- | ---------------- | ----------------------------------------------------------------------- |
| `GET`    | `/api/tasks/[id]/web-links`                  | —                | `TaskWebLinkDTO[]`, sorted `createdAt desc`                             |
| `POST`   | `/api/tasks/[id]/web-links`                  | `{ url, note? }` | `TaskWebLinkDTO` (synchronous OG fetch attempted, included in response) |
| `DELETE` | `/api/tasks/[id]/web-links/[linkId]`         | —                | `204`                                                                   |
| `POST`   | `/api/tasks/[id]/web-links/[linkId]/refresh` | —                | `TaskWebLinkDTO` (re-fetches OG, updates record)                        |

Each route stays in the project's 50–100 line budget: parse → zod validate → resolve session → call service → return.

`TaskWebLinkDTO` shape — direct projection of the Prisma columns plus `createdBy: { id, name, email }`.

## Service Layer

`lib/services/task-web-link.service.ts`:

```ts
addWebLink({ taskId, url, note, userId, workspaceId }): Promise<TaskWebLinkDTO>
  // 1. Resolve task, verify it belongs to workspaceId.
  // 2. Verify userId is a workspace member.
  // 3. Normalize URL, derive domain.
  // 4. Call fetchOpenGraph(url) — never throws; returns { ok, data?, error? }.
  // 5. Build payload:
  //      - title, description, imageUrl, faviconUrl from og data (or null on failure)
  //      - note from user input (untouched by fetcher)
  //      - fetchedAt = now on success, null on failure
  //      - fetchError = null on success, error string on failure
  // 6. repo.create(payload).
  // 7. Return DTO.

listWebLinks({ taskId, userId, workspaceId }): Promise<TaskWebLinkDTO[]>
  // Verify task access → repo.listByTask.

deleteWebLink({ linkId, userId, workspaceId }): Promise<void>
  // Load link, verify task in workspace, verify (createdById === userId)
  //   || workspace role === OWNER. Else throw 403.
  // repo.delete.

refreshWebLink({ linkId, userId, workspaceId }): Promise<TaskWebLinkDTO>
  // Verify task access (any workspace member, no destructive change).
  // Re-fetch OG; repo.update overwrites title, description, imageUrl, faviconUrl,
  //   fetchedAt, fetchError. NEVER overwrites note — that column is user-owned.
  // Return DTO.
```

Errors use the project's existing pattern: `throw Object.assign(new Error(msg), { status: 403 })` etc.

## OG Fetcher (`lib/integrations/og-metadata/`)

```
fetch.ts        export async function fetchOpenGraph(url): Promise<FetchResult>
parse.ts        export function parseHtml(html, baseUrl): OgData
constants.ts    TIMEOUT_MS=5000, MAX_BODY_BYTES=3_145_728, USER_AGENT='Lumo-LinkPreview/1.0'
ssrf.ts         export async function assertExternalHost(url): Promise<void>
index.ts        barrel (server-only)
```

**`fetchOpenGraph(url)` contract**:

1. `assertExternalHost(url)` — DNS-resolve hostname; if any A/AAAA record is in a private/loopback/link-local range, throw. **Must be enforced before the fetch.** See SSRF section.
2. `fetch(url, { signal: AbortSignal.timeout(5000), headers: { 'User-Agent': ..., 'Accept': 'text/html,application/xhtml+xml' }, redirect: 'follow' })`.
   - Re-check each redirect target against `assertExternalHost` (`fetch` does not let us hook redirects directly; either set `redirect: 'manual'` and follow up to 5 hops manually, or use a small helper). **Manual redirect handling is the safer default.**
3. If `!response.ok` → `{ ok: false, error: 'http ' + status }`.
4. If `Content-Type` does not start with `text/html` or `application/xhtml+xml` → `{ ok: false, error: 'non-html content' }`.
5. Stream the body; if cumulative bytes exceed `MAX_BODY_BYTES`, abort and return `{ ok: false, error: 'body too large' }`.
6. `parseHtml(html, finalUrl)`:
   - `title`: `<meta property="og:title">` → `<meta name="twitter:title">` → `<title>`
   - `description`: `<meta property="og:description">` → `<meta name="twitter:description">` → `<meta name="description">`
   - `imageUrl`: `<meta property="og:image">` → `<meta name="twitter:image">`; resolved to absolute URL via `finalUrl`
   - `faviconUrl`: `<link rel="icon">` / `<link rel="shortcut icon">` → fallback to `/favicon.ico` on origin; resolved to absolute
7. Return `{ ok: true, data: { title, description, imageUrl, faviconUrl } }`. Any field may be undefined.

Never throws — all failure modes return `{ ok: false, error }`.

**HTML parser choice** (decide in implementation plan): `node-html-parser` (zero deps, fast, edge-runtime friendly) vs `cheerio` (heavier, full jQuery-like API). Default preference: `node-html-parser` unless the project already depends on `cheerio`.

## SSRF Defense (required, not optional)

The fetcher must refuse to make requests to internal addresses. Without this, a user can submit `http://169.254.169.254/...` (cloud metadata endpoint) or `http://10.0.0.5/admin` and the server will dutifully fetch it.

`assertExternalHost(url)` must:

1. Resolve the hostname via `dns.promises.lookup(host, { all: true })`.
2. Reject if **any** returned address falls in:
   - IPv4 loopback: `127.0.0.0/8`
   - IPv4 private: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
   - IPv4 link-local: `169.254.0.0/16`
   - IPv4 multicast: `224.0.0.0/4`
   - IPv4 reserved: `0.0.0.0/8`
   - IPv6 loopback: `::1/128`
   - IPv6 link-local: `fe80::/10`
   - IPv6 unique-local: `fc00::/7`
   - IPv6 multicast: `ff00::/8`
   - IPv4-mapped IPv6: rejected if the embedded IPv4 hits any of the above
3. Throw on any match; the fetcher converts to `{ ok: false, error: 'host not allowed' }`.

This must run on each redirect target too — hence manual redirect handling (max 5 hops).

`net.isIP` + a small CIDR helper covers this; no extra dep required. Test coverage in `__tests__/lib/integrations/og-metadata/ssrf.test.ts` is non-negotiable.

## Permissions

| Operation | Allowed roles                         |
| --------- | ------------------------------------- |
| List      | Any workspace member                  |
| Create    | Any workspace member                  |
| Delete    | Link creator **OR** workspace `OWNER` |
| Refresh   | Any workspace member                  |

Same model as `TaskSlackContext`.

## Frontend

### Component tree

`app/workspace/[workspaceUrl]/components/TaskDetailTimeline/`:

```
sections/WebLinkSection.tsx      — section header + add button + list of cards; empty state
WebLinkCard.tsx                  — single card with image, title, description, domain, time, actions menu
WebLinkAddDialog.tsx             — shadcn Dialog with URL + Notes fields
```

API client: `lib/api-client/task-web-links.ts` with `listWebLinks / addWebLink / deleteWebLink / refreshWebLink`.

### Card layout

```
┌────────────────────────────────────────────────────┐
│ [og:image    ]  Title (1 line, ellipsized)        │
│ [120×90 img  ]  note ?? description (2 lines)     │
│                 example.com  ·  3 hours ago       │
│                                          [⋯ menu] │
└────────────────────────────────────────────────────┘
```

Second-line text is the user's `note` if present, otherwise the fetched `description`. Both ellipsized to 2 lines.

Whole card is an `<a href={url} target="_blank" rel="noopener noreferrer">`. Actions menu (top-right): `Refresh preview` (any member), `Delete` (creator or workspace owner — hidden otherwise).

### Fetch-failed fallback

```
┌────────────────────────────────────────────────────┐
│ [favicon] example.com                              │
│           https://example.com/long/path...         │
│           Preview unavailable · 3 hours ago [⋯]   │
└────────────────────────────────────────────────────┘
```

No loading state on add — fetch is synchronous server-side. Refresh action shows a local spinner overlay on the card.

### Add dialog

- URL field (required, `<input type="url">` for browser-side quick validation)
- Notes field (optional, textarea, 500 char limit matching zod) — stored in the `note` column, never overwritten by metadata refresh
- Submit:
  - Success → close dialog, prepend card to list
  - 400 (invalid URL) → keep dialog open, show inline error under the URL field
  - 200 with fetch failure → same as success; card renders fallback variant

### XSS / security in rendering

- `title` / `description` rely on React's default escaping.
- `imageUrl` / `faviconUrl`: client re-validates scheme on render — if not `http://` or `https://`, fall back to favicon-only display. Server already validates on store, this is defense in depth.
- All anchor `href`s validated client-side: non-`http(s)` → render as plain text.
- `<img>` tags use `referrerPolicy="no-referrer"` to avoid leaking the Lumo URL to third-party hosts.

### Timeline ordering

The Web Links section sits alongside the existing Slack section in `TaskDetailTimeline`. Empty section is collapsed by default (matches existing convention).

## I18n

Per project rules: add keys to **every** locale file in `lib/i18n/`, not just `en.json` and `zh-CN.json`. Never English-as-fallback for non-English locales.

Namespace: `task.webLinks.*`.

| Key                                    | en                                                       | zh-CN                               |
| -------------------------------------- | -------------------------------------------------------- | ----------------------------------- |
| `task.webLinks.sectionTitle`           | Web Links                                                | 网页链接                            |
| `task.webLinks.empty`                  | No links yet                                             | 暂无链接                            |
| `task.webLinks.addButton`              | Add link                                                 | 添加链接                            |
| `task.webLinks.dialog.title`           | Add a web link                                           | 添加网页链接                        |
| `task.webLinks.dialog.urlLabel`        | URL                                                      | URL                                 |
| `task.webLinks.dialog.urlPlaceholder`  | https://…                                                | https://…                           |
| `task.webLinks.dialog.noteLabel`       | Notes (optional)                                         | 备注（可选）                        |
| `task.webLinks.dialog.submit`          | Add link                                                 | 添加                                |
| `task.webLinks.error.invalidUrl`       | URL must start with http:// or https://                  | URL 必须以 http:// 或 https:// 开头 |
| `task.webLinks.error.urlTooLong`       | URL is too long                                          | URL 太长                            |
| `task.webLinks.error.noteTooLong`      | Notes must be 500 characters or fewer                    | 备注最多 500 字符                   |
| `task.webLinks.error.fetchFailed`      | Preview unavailable                                      | 暂无预览                            |
| `task.webLinks.error.permissionDenied` | Only the link creator or workspace owner can delete this | 只有添加者或工作区所有者可以删除    |
| `task.webLinks.card.refresh`           | Refresh preview                                          | 刷新预览                            |
| `task.webLinks.card.delete`            | Delete                                                   | 删除                                |
| `task.webLinks.confirmDelete`          | Delete this link?                                        | 确定删除此链接？                    |

If the project also has `ja.json` / `zh-TW.json` etc., translate the same keys. Implementation plan must enumerate the full locale list from `lib/i18n/` to ensure none are missed.

## Task Context Integration

`lumo task context <LUM-N>` (current implementation lives in the Lumo server's task-context formatter — exact entry point to be located in the implementation plan) gets a new section:

```markdown
## Web Links (3)

- [Building distributed systems at scale](https://example.com/article) — example.com
  > A deep-dive into consensus protocols and how we use them at scale.
- https://figma.com/file/abc123 — figma.com _(no preview available)_
- ...
```

Title resolution order in markdown: `title` field → `url` (if title null).
Body line resolution: `note ?? description` — shown only when one is present.
"(no preview available)" suffix when `fetchedAt` is null.

## Testing

Per `CLAUDE.md`: every new function gets at least one test. Jest, `__tests__/`, `*.test.ts`.

**Repository** — `__tests__/lib/repositories/task-web-link.repository.test.ts`

- `create` / `listByTask` / `getById` / `update` / `delete` happy paths
- `listByTask` returns `createdAt desc`
- `delete` on missing id returns null (no throw)

**Service** — `__tests__/lib/services/task-web-link.service.test.ts` (mock repo + mock fetcher)

- `addWebLink` fetch ok → record stored with OG fields, `fetchedAt` set, `fetchError` null
- `addWebLink` fetch fails → record stored, OG fields null, `fetchError` set, `note` still populated if user supplied one
- `addWebLink` URL normalization: fragment stripped, scheme/host lowercased
- `addWebLink` user-supplied `note` stored in `note` column; OG `description` stored in `description` column — they are independent
- `addWebLink` non-member user → 403
- `deleteWebLink` non-creator non-owner → 403
- `deleteWebLink` creator → success
- `deleteWebLink` owner (non-creator) → success
- `refreshWebLink` updates `fetchedAt` and overwrites OG-owned fields (title/description/imageUrl/faviconUrl)
- `refreshWebLink` preserves `note` — assert that an existing user note is unchanged after refresh

**OG fetcher** — `__tests__/lib/integrations/og-metadata/fetch.test.ts` (mock global `fetch`)

- Full OG meta → all fields parsed
- Missing og: tags, falls back to `<title>` and `<meta name="description">`
- Non-HTML content-type → `{ ok: false }`
- Timeout → `{ ok: false, error: 'timeout' }`
- 4xx / 5xx → `{ ok: false, error: 'http <status>' }`
- Relative favicon path → resolved to absolute URL
- Relative og:image → resolved to absolute URL
- Body exceeds 3 MB → aborts, `{ ok: false, error: 'body too large' }`

**SSRF guard** — `__tests__/lib/integrations/og-metadata/ssrf.test.ts`

- Rejects `http://127.0.0.1/`, `http://10.0.0.1/`, `http://192.168.1.1/`, `http://169.254.169.254/`, `http://[::1]/`, `http://[fc00::1]/`
- Allows `http://example.com/` (resolves to a public IP — use mocked DNS lookup)
- Hostname that resolves to a public IP and then redirects to `http://10.0.0.1/` is rejected on the redirect hop

**API routes** — `__tests__/app/api/tasks/web-links/route.test.ts`

- `POST` missing url → 400
- `POST` `javascript:...` URL → 400
- `POST` unauthenticated → 401
- `POST` success → 200 + DTO
- `GET` cross-workspace task → 404
- `DELETE` non-existent → 404
- `DELETE` unauthorized → 403

**Manual verification** (preview server, before declaring done):

- Add a link, card appears with metadata
- Add a malformed/blocked URL, see inline error
- Add a public URL that fails fetch (e.g. 404), see fallback card
- Refresh button refetches
- Non-creator non-owner user does not see delete option
- Switch i18n to zh-CN; all strings render

## Acceptance Checklist

- [ ] Prisma migration applies cleanly in dev; CI/CD picks it up on deploy
- [ ] `npm test` green
- [ ] `npx tsc --noEmit` clean
- [ ] No `console.log` in production code
- [ ] All locale files in `lib/i18n/` updated with full translations (no English fallbacks)
- [ ] `lumo task context LUM-47` output includes the Web Links section, with and without links present
- [ ] Manual preview verification covers the cases above
- [ ] Branch: `lumo/LUM-47-add-web-links-task-context`
- [ ] PR title: `feat: add web links as task context [LUM-47]`
- [ ] PR description calls out: schema change → requires `prisma migrate deploy` on next deploy

## Rollback

- **Migration deployed, UI/API broken** → revert UI/API code; keep the new table. Foreign key cascade means task deletion cleans up rows. **Do not** revert the migration — it would drop user-saved links.
- **OG fetcher misbehaves in production** → no feature flag in v1; if needed, hotfix the fetcher to short-circuit (return `{ ok: false }` immediately) so adds still work but no metadata is populated. Existing rows are unaffected.
- **SSRF abuse detected** → SSRF guard is enforced from v1, so this is the floor. If a bypass is found, the immediate mitigation is to make `assertExternalHost` always throw — adds will still work but every fetch will be marked failed. Then patch the guard.

## Out of Scope (explicit non-goals listed for completeness)

See the top-level **Non-Goals (v1)** section.
