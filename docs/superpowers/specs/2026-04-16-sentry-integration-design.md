# Sentry Integration Design Spec

**Date:** 2026-04-16
**Status:** Draft

---

## Goal

Let a Lumo workspace connect to its Sentry organization so that Sentry alerts automatically create Lumo tasks in a designated project. One-way pipeline only (Sentry → Lumo). No bi-directional status sync, no manual browsing, no Lumo-side filtering.

Scope boundaries:

- **In scope:** alert → task automation; per-Sentry-project mapping to Lumo projects; strict deduplication (one issue → one task); auto-assignment via suggested owners; automatic `bug` tag.
- **Out of scope (future):** manual issue linking (`b`), Sentry issue browser inside Lumo (`c`), resolving Sentry from Lumo (`d`), activity stream on every event (`e`), Sentry public marketplace app.

---

## Architecture

**Approach:** Sentry Internal Integration (no OAuth, no marketplace listing). User creates an Internal Integration in their Sentry org with a webhook URL pointing at Lumo; the integration's `clientSecret` is pasted into Lumo and used to verify HMAC signatures on incoming webhooks. Lumo never needs to call Sentry's REST API, so no access token is stored.

**Tech stack:**

- Next.js 14 App Router
- TypeScript (strict)
- Prisma / Neon
- `lib/crypto.ts` (AES-256-GCM) for `clientSecret` at rest
- Clerk auth
- Tailwind / shadcn
- `lucide-react`
- Node `crypto.timingSafeEqual` for signature verification

**Layering (follows CLAUDE.md):** `Component → API Client → API Route → Service → Repository → Prisma`.

---

## Data Models

```prisma
model SentryIntegration {
  id           String   @id @default(cuid())
  workspaceId  String   @unique   // one Sentry org per Lumo workspace
  installedBy  String?            // WorkspaceMember.id who connected (nullable for SetNull on member delete)
  installer    WorkspaceMember? @relation("SentryInstaller", fields: [installedBy], references: [id], onDelete: SetNull)

  orgSlug        String   @unique   // Sentry organization slug (e.g. "acme-inc")
  clientSecret   String             // AES-256-GCM encrypted ("iv:authTag:ciphertext" hex)
  lastWebhookAt  DateTime?          // set on every successfully signature-verified webhook; powers "Test webhook" UI

  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  workspace       Workspace               @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  projectMappings SentryProjectMapping[]
  issueLinks      SentryIssueLink[]

  @@index([orgSlug])
  @@map("sentry_integrations")
}

model SentryProjectMapping {
  id                String   @id @default(cuid())
  integrationId     String
  sentryProjectSlug String             // e.g. "backend-api"
  projectId         String             // Lumo project id
  createdAt         DateTime @default(now())

  integration SentryIntegration @relation(fields: [integrationId], references: [id], onDelete: Cascade)
  project     Project           @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@unique([integrationId, sentryProjectSlug])   // one mapping per Sentry project
  @@index([integrationId])
  @@index([projectId])
  @@map("sentry_project_mappings")
}

model SentryIssueLink {
  id            String   @id @default(cuid())
  integrationId String
  sentryIssueId String             // Sentry's stable issue_id across events
  taskId        String
  createdAt     DateTime @default(now())

  integration SentryIntegration @relation(fields: [integrationId], references: [id], onDelete: Cascade)
  task        Task              @relation(fields: [taskId], references: [id], onDelete: Cascade)

  @@unique([integrationId, sentryIssueId])
  @@index([taskId])
  @@map("sentry_issue_links")
}
```

**Back-relations added to existing models:**

- `Workspace.sentryIntegration SentryIntegration?`
- `WorkspaceMember.sentryInstalled SentryIntegration[] @relation("SentryInstaller")`
- `Project.sentryProjectMappings SentryProjectMapping[]`
- `Task.sentryIssueLinks SentryIssueLink[]`

**Enum changes:**

- `TaskActivityType` — add `SENTRY_ALERT` (used when a repeat Sentry alert is recorded on an existing task, and when a DONE task is reopened by a regression).

**Rationale notes:**

- `orgSlug @unique` — enforces 1:1 binding between a Sentry org and a Lumo workspace. Simpler than broadcasting webhooks to multiple matching integrations. If multi-binding ever becomes a requirement, switch to matching on `installation.uuid` (needs extra field).
- No `accessToken` field — webhook reception is push-only; we never call Sentry's REST API in this scope.
- `SentryIssueLink.taskId onDelete: Cascade` — deleting a task removes the link; a later alert for the same Sentry issue is treated as a fresh issue and a new task is created. This matches the user's explicit choice ("deleted task = team closed the case").

---

## User Flow A — Connect Sentry (one-time, workspace OWNER only)

1. Owner opens `Settings → Integrations`, clicks **Connect Sentry** on the `SentryIntegrationCard`.
2. `SentryConnectDialog` opens, showing two steps:
   - **Step 1 (guide):** display the webhook URL (`{APP_URL}/api/webhooks/sentry`) with a copy button, plus a link to Sentry's Custom Integration docs. Instruct the user to:
     - In Sentry: `Organization Settings → Developer Settings → New Internal Integration`
     - Paste the webhook URL
     - Enable **Alerts → "Issue Alert"**
     - Copy the generated `Client Secret`
   - **Step 2 (form):** two fields — `Organization Slug` (free text, validated as lowercase alphanumeric + hyphens) and `Client Secret` (password input).
3. Submit → `POST /api/sentry/integration` with `{ orgSlug, clientSecret }`.
4. Server: Zod-validate shape → `sentryService.connectIntegration(...)` encrypts `clientSecret` with AES-256-GCM → `upsertIntegration` (upsert semantics allow rotating the secret later).
5. Response sets UI to "Connected"; owner can now open **Manage mappings**.

**Degraded validation:** we do not remotely verify the `orgSlug` at connect time. An Internal Integration's `clientSecret` cannot authenticate REST API calls (REST auth uses user tokens or OAuth). Real verification happens on the first webhook: if signature verification fails, Sentry shows the webhook as failing in its own dashboard. The `SentryIntegrationCard` includes a "Test webhook" prompt that tells the user to click Sentry's **Send Test Request** button in Sentry. When Lumo receives a valid signed request, `sentryService.handleWebhook` writes `lastWebhookAt = now()` on the integration row; the card polls `GET /api/sentry/integration` and shows "✓ Received a verified webhook" once that timestamp is populated.

---

## User Flow B — Configure mappings

1. From the card, owner opens **Manage mappings** (either a dedicated `/settings/integrations/sentry/mappings` page or an inline dialog — implementation choice, default to dialog for parity with `ProjectSlackDialog`).
2. UI lists existing `SentryProjectMapping` rows: Sentry slug + Lumo project name + delete button.
3. Add row: text input for `sentryProjectSlug` + Lumo project selector → `POST /api/sentry/mappings`.
4. Helper text below input: "The slug is the last segment of your Sentry project URL: `/organizations/<org>/projects/<slug>/`".
5. Duplicates blocked by `@@unique(integrationId, sentryProjectSlug)` — 409 on conflict.
6. Multiple Sentry slugs mapping to the same Lumo project is **allowed** (common: frontend + backend both dumping into one product project).

---

## User Flow C — Webhook (runtime, per Sentry alert)

```
POST /api/webhooks/sentry
  headers:
    sentry-hook-resource:  "event_alert" | "issue_alert"
    sentry-hook-timestamp: <ms>
    sentry-hook-signature: HMAC-SHA256(clientSecret, raw_body)
  body: { action, data: { issue, event, triggered_rule }, installation: { uuid } }

handler:
  1. Read raw body (preserve for signature check) + parse JSON
     → malformed JSON → 400
     → missing signature header → 401
  2. Extract orgSlug from data.event.project.organization.slug
     → missing → 400
  3. findIntegrationByOrgSlug(orgSlug)
     → not found → 404
  4. decrypt(clientSecret) + verifySentrySignature(rawBody, signature, secret)
     (crypto.timingSafeEqual)
     → mismatch → 401
  5. sentryProjectSlug = data.event.project.slug
     findMappingByProjectSlug(integrationId, sentryProjectSlug)
     → not found → 200 { skipped: "no mapping" }
  6. sentryIssueId = data.event.issue_id
     findLink(integrationId, sentryIssueId)
     → exists  → _handleRepeatedAlert(link, payload)
     → missing → _createTaskFromIssue(integration, mapping, payload)
  7. return 200
```

**Error policy (post-auth):** any exception inside steps 5–6 is caught, logged as `console.error('[sentry/webhook] ...', err)`, and the route still returns 200. This matches `app/api/webhooks/github/route.ts` and prevents Sentry from retry-storming on our internal bugs. Auth-layer errors (400/401/404) return their proper status.

**Replay protection:** not implemented in v1 (consistent with GitHub webhook handling). `sentry-hook-timestamp` is captured in logs for forensics.

---

## Task Creation

Fields written when a first-time issue arrives (`_createTaskFromIssue`):

| Task field    | Source / rule                                        |
| ------------- | ---------------------------------------------------- |
| `workspaceId` | `mapping.integration.workspaceId`                    |
| `projectId`   | `mapping.projectId`                                  |
| `title`       | `data.event.title`, truncated to 200 chars           |
| `description` | Markdown template (see below)                        |
| `status`      | `TODO`                                               |
| `priority`    | `mapLevelToPriority(data.event.level)` — see table   |
| `assigneeId`  | `_resolveAssignee(integration, payload)` — see below |
| `tags`        | `[_ensureBugTag(workspaceId)]`                       |

**Priority mapping:**

| Sentry `level`                    | Lumo `TaskPriority` |
| --------------------------------- | ------------------- |
| `fatal`                           | `URGENT`            |
| `error`                           | `HIGH`              |
| `warning`                         | `MEDIUM`            |
| `info`, `debug`, unknown, missing | `LOW`               |

**Description template** — the markdown string emitted by `buildTaskDescription` follows this shape (using `~~~` here only to avoid nesting confusion; the real output uses triple-backtick fences):

````
**Sentry issue:** [{title}]({webUrl})

**Culprit:** `{culprit}`
**Level:** `{level}`
**Events:** {eventCount} · **First seen:** {firstSeen ISO} · **Last seen:** {lastSeen ISO}

**Stack (top 5 frames):**
```
  at {function} ({filename}:{lineno})
  at {function} ({filename}:{lineno})
  ...
```

_Created automatically from Sentry alert._
````

Stack is taken from `data.event.entries[type=stacktrace].data.frames`, reversed so innermost frame first, sliced to 5, each line truncated to 200 chars. Missing stack → omit the whole stack block.

**Assignee resolution (`_resolveAssignee`):**

1. Collect emails from `data.event.suggestedOwners[].owner` where `type === 'user'`; fallback to `data.actor.email` if present.
2. For each email in order, call `memberRepository.findByEmail(workspaceId, email)` (add this method if it does not exist — grep first for similar lookups in invite/member service).
3. Return the first match; otherwise `null`.

**Bug tag (`_ensureBugTag`):**

- `tagRepository.findByName(workspaceId, 'bug')` → return id.
- Missing → `tagRepository.create({ workspaceId, name: 'bug', color: '#ef4444' })`.
- On `P2002` race, re-find.

**Transactional atomicity:** task creation and `SentryIssueLink` creation happen inside `prisma.$transaction` so that we can never end up with a task but no link (which would duplicate on the next alert). On `P2002` for the link (concurrent webhook race), the outer handler retries by falling back to `_handleRepeatedAlert`.

**Cross-service call:** `sentryService` must not write to `prisma.task` directly. Add `taskService.createFromAutomation({ workspaceId, projectId, title, description, priority, assigneeId?, tagIds? })` that:

- delegates to `taskRepository.create`,
- creates `TaskTag` rows,
- triggers the standard "task assigned" notification only when `assigneeId` is non-null (reuse existing notification path used by manual task creation).

---

## Repeated Alert Handling (`_handleRepeatedAlert`)

When `SentryIssueLink` already exists for `(integrationId, sentryIssueId)`:

1. `taskActivityRepository.create({ taskId, type: 'SENTRY_ALERT', actorId: null, metadata })` where `metadata` captures:
   - `triggeredRuleLabel` (from `data.triggered_rule` if present)
   - `eventCount`, `lastSeen`
   - `action` (e.g. `created`, `regressed`)
2. If `task.status === 'DONE'`:
   - `taskService.reopen(taskId, { reason: 'sentry_regression', actorId: null })` — sets status back to `TODO`, records a second activity `Reopened due to Sentry regression`.
   - If `taskService` has no system/null-actor reopen path yet, extend `taskService.reopen` to accept `{ actorId: null }` and a `reason` tag that surfaces in the activity UI.

**Task timeline UI impact:** add a render case in the existing `TaskActivity` component for `SENTRY_ALERT` (small Sentry/lucide icon + rendered metadata). Unknown-type activities must be rendered as a safe fallback, not crash.

---

## Directory & File Layout

```
lib/integrations/sentry/
  index.ts                    # barrel (types + verifySentrySignature + constants)
  types.ts                    # SentryWebhookPayload, SentryIssueLevel, etc.
  verify.ts                   # verifySentrySignature(rawBody, signature, secret): boolean
  payload.ts                  # extractIssueFields, mapLevelToPriority,
                              # buildTaskDescription, pickSuggestedOwnerEmails

lib/repositories/
  sentry.repository.ts

lib/services/
  sentry.service.ts

lib/validation/
  sentry.schema.ts            # connectSentrySchema, createMappingSchema

lib/api-client/
  sentry.ts                   # sentryApi.* client methods

app/api/sentry/
  integration/route.ts        # GET status, POST connect, DELETE disconnect
  mappings/route.ts           # GET list, POST create
  mappings/[id]/route.ts      # DELETE

app/api/webhooks/sentry/
  route.ts                    # POST (receives Sentry webhooks)

app/workspace/[workspaceUrl]/components/
  SentryIntegrationCard.tsx
  SentryConnectDialog.tsx
  SentryMappingsDialog.tsx

app/workspace/[workspaceUrl]/components/pages/
  IntegrationsPage.tsx        # add <SentryIntegrationCard />
```

**Repository surface (`sentryRepository`):**

- `findIntegrationByWorkspace(workspaceId)`
- `findIntegrationByOrgSlug(orgSlug)`
- `upsertIntegration(data)`
- `deleteIntegration(workspaceId)`
- `listMappings(integrationId)`
- `findMappingByProjectSlug(integrationId, sentryProjectSlug)`
- `findProjectInWorkspace(projectId, workspaceId)` _(or reuse existing)_
- `createMapping(data)`
- `deleteMapping(mappingId)`
- `findLink(integrationId, sentryIssueId)`
- `createLinkWithTask(tx, { integrationId, sentryIssueId, taskArgs })`

**Service surface (`sentryService`):**

- `getIntegrationStatus(workspaceId)`
- `connectIntegration(workspaceId, memberId, role, { orgSlug, clientSecret })` — OWNER only
- `disconnectIntegration(workspaceId, role)` — OWNER only
- `listMappings(workspaceId)`
- `createMapping(workspaceId, role, { sentryProjectSlug, projectId })` — OWNER only
- `deleteMapping(workspaceId, role, mappingId)` — OWNER only
- `handleWebhook({ rawBody, signature, payload })`
- private: `_createTaskFromIssue`, `_handleRepeatedAlert`, `_resolveAssignee`, `_ensureBugTag`

---

## Error Handling & Edge Cases

| Situation                                            | Response                                                               | Log   |
| ---------------------------------------------------- | ---------------------------------------------------------------------- | ----- |
| Body not JSON                                        | 400                                                                    | warn  |
| Missing `sentry-hook-signature` header               | 401                                                                    | warn  |
| `orgSlug` not extractable from payload               | 400                                                                    | warn  |
| Integration not found for `orgSlug`                  | 404                                                                    | info  |
| Signature mismatch                                   | 401                                                                    | warn  |
| Mapping missing for `sentryProjectSlug`              | 200                                                                    | info  |
| Parsed payload missing `issue_id`                    | 200                                                                    | error |
| Parsed payload missing `level`                       | Use `LOW`; continue                                                    | info  |
| Task creation / DB write fails                       | 200                                                                    | error |
| `P2002` on `SentryIssueLink` create (concurrent)     | Retry via `_handleRepeatedAlert`                                       | info  |
| Non-OWNER hits connect / disconnect / mapping routes | 403                                                                    | info  |
| OWNER re-connects (integration exists)               | 200 (upsert overwrites secret)                                         | info  |
| Owner deletes integration                            | Cascade deletes mappings + issue links; **tasks are preserved**        | info  |
| User deletes a mapping                               | Cascade deletes; existing tasks preserved                              | info  |
| User deletes a Lumo project that has mappings        | Cascade deletes mappings (standard Prisma behaviour)                   | info  |
| User deletes a linked task                           | Cascade deletes the link; next alert for same issue creates a new task | info  |

**Signature verification** uses `crypto.timingSafeEqual` against `HMAC-SHA256(clientSecret, rawBody)`. Implementation mirrors `lib/integrations/github/verify.ts`.

**Rate limiting:** webhook route is unauthenticated in the HTTP sense but gated by signature verification; no separate rate limit. Management routes are gated by Clerk auth middleware like any other workspace API.

**Logging:** all Sentry-integration logs prefix `[sentry/...]` (e.g. `[sentry/webhook]`, `[sentry/connect]`). Consistent with existing `[webhook/github]` and `[slack create-channel]` patterns. No structured logger exists repo-wide yet; follow the status quo.

---

## Testing

Jest, `__tests__/` colocated, `*.test.ts`. Every new function gets at least one test per CLAUDE.md.

**Pure unit tests:**

- `lib/integrations/sentry/verify.test.ts` — positive sig, negative sig (altered byte), empty body, wrong secret, timing-safe behaviour.
- `lib/integrations/sentry/payload.test.ts`
  - `extractIssueFields` — happy path against fixture
  - missing `event.level` → defaults to `'info'`
  - no `suggestedOwners` → empty array
  - `mapLevelToPriority` — one case per level + unknown → `LOW`
  - `buildTaskDescription` — snapshot, stack >5 frames truncated to 5, each line >200 chars truncated

**Repository tests** (mock `prisma` client):

- `findIntegrationByOrgSlug`, `upsertIntegration` overwrites, `createLinkWithTask` inside a transaction, mapping CRUD.

**Service tests** (mock repository):

- `connectIntegration` non-OWNER → throws 403
- `connectIntegration` encrypts `clientSecret` before upsert
- `disconnectIntegration` delegates and preserves tasks
- `handleWebhook`:
  - bad signature → throws 401
  - unknown `orgSlug` → throws 404
  - mapping missing → returns `{ skipped: 'no mapping' }`
  - first-time issue → calls `taskService.createFromAutomation` + creates link (transaction)
  - repeated issue → no task creation, calls activity create
  - repeated issue on `DONE` task → calls `taskService.reopen`
  - `P2002` on link create → falls back to `_handleRepeatedAlert`
- `_resolveAssignee` — email matches member / no match returns null
- `_ensureBugTag` — found returns id / missing creates / race recovers via re-find

**Route tests:**

- `app/api/webhooks/sentry/__tests__/route.test.ts`
  - missing signature → 401
  - bad signature → 401
  - valid + mapped → 200 and service called
  - valid + unmapped project → 200 (skipped)
  - service throws → 200 (error swallowed, logged)
- `app/api/sentry/integration/__tests__/route.test.ts`
  - unauthenticated → 401 (Clerk middleware)
  - authenticated non-OWNER POST → 403
  - OWNER POST → 200, secret encrypted
  - GET returns status
- `app/api/sentry/mappings/__tests__/route.test.ts` — minimal CRUD + permission.

**Not tested** (matches existing Lumo convention):

- UI components (no `*.test.tsx` in repo today).
- Internationalization / translations of user-facing copy.

**Fixtures required:**

- `__tests__/fixtures/sentry-issue-alert.json` — real-shaped Sentry issue alert payload.
- `__tests__/fixtures/sentry-issue-alert-regression.json` — regression-triggered variant.

---

## Implementation Order (for the plan step)

1. Schema migration (`SentryIntegration`, `SentryProjectMapping`, `SentryIssueLink`; back-relations; `TaskActivityType.SENTRY_ALERT`).
2. `lib/integrations/sentry/` pure modules (`types`, `verify`, `payload`) + tests + fixtures.
3. `sentryRepository` + tests.
4. `taskService.createFromAutomation` + `taskService.reopen` extension + tests.
5. `sentryService` + tests.
6. Validation schemas + API routes (management + webhook) + route tests.
7. API client.
8. UI: `SentryIntegrationCard`, `SentryConnectDialog`, `SentryMappingsDialog`; mount in `IntegrationsPage`.
9. Task timeline rendering for `SENTRY_ALERT` activity type.

---

## Explicit Non-Goals (v1)

- No Sentry OAuth / marketplace app.
- No Lumo-side level/frequency filtering (user controls via Sentry alert rules).
- No replay-window check on `sentry-hook-timestamp`.
- No remote verification of `orgSlug` / `clientSecret` at connect time.
- No task → Sentry status push (resolve/unresolve).
- No per-mapping priority override / per-mapping assignee override (can be added later as columns on `SentryProjectMapping`).
- No structured logger refactor.
