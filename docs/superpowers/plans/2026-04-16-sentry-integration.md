# Sentry Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Lumo workspace connect a Sentry organization so that Sentry alerts automatically create Lumo tasks in configured projects, with strict deduplication, auto-assignment from Sentry suggested owners, and an automatic `bug` tag.

**Architecture:** Sentry Internal Integration (no OAuth). User pastes `orgSlug` + `clientSecret` into Lumo; we store the secret AES-256-GCM encrypted and use it to verify HMAC-SHA256 signatures on incoming webhooks. New Prisma models `SentryIntegration`, `SentryProjectMapping`, `SentryIssueLink` wire a Sentry project slug to a Lumo project and deduplicate issues by stable `sentryIssueId`. Pure payload parsing lives in `lib/integrations/sentry/payload.ts`; orchestration in `lib/services/sentry.service.ts`; thin API routes at `app/api/sentry/*` and `app/api/webhooks/sentry`.

**Tech Stack:** Next.js 14 App Router · TypeScript (strict) · Prisma/Neon · `lib/crypto.ts` (AES-256-GCM) · Clerk auth · Node `crypto.timingSafeEqual` · Tailwind · shadcn/ui · lucide-react · Jest.

**Spec reference:** [docs/superpowers/specs/2026-04-16-sentry-integration-design.md](../specs/2026-04-16-sentry-integration-design.md)

---

## File Structure

Create:

- `prisma/migrations/<timestamp>_sentry_integration/migration.sql` (generated)
- `lib/integrations/sentry/types.ts`
- `lib/integrations/sentry/verify.ts`
- `lib/integrations/sentry/payload.ts`
- `lib/integrations/sentry/index.ts`
- `lib/repositories/sentry.repository.ts`
- `lib/services/sentry.service.ts`
- `lib/validation/sentry.schema.ts`
- `lib/api-client/sentry.ts`
- `app/api/sentry/integration/route.ts`
- `app/api/sentry/mappings/route.ts`
- `app/api/sentry/mappings/[id]/route.ts`
- `app/api/webhooks/sentry/route.ts`
- `app/workspace/[workspaceUrl]/components/SentryIntegrationCard.tsx`
- `app/workspace/[workspaceUrl]/components/SentryConnectDialog.tsx`
- `app/workspace/[workspaceUrl]/components/SentryMappingsDialog.tsx`
- `__tests__/fixtures/sentry-issue-alert.json`
- `__tests__/fixtures/sentry-issue-alert-regression.json`
- `__tests__/lib/integrations/sentry/verify.test.ts`
- `__tests__/lib/integrations/sentry/payload.test.ts`
- `__tests__/lib/repositories/sentry.repository.test.ts`
- `__tests__/lib/services/sentry.service.test.ts`
- `__tests__/api/sentry/integration-route.test.ts`
- `__tests__/api/sentry/mappings-route.test.ts`
- `__tests__/api/webhooks/sentry-route.test.ts`

Modify:

- `prisma/schema.prisma` — add `SentryIntegration`, `SentryProjectMapping`, `SentryIssueLink` models; back-relations on `Workspace`/`WorkspaceMember`/`Project`/`Task`; add `SENTRY_ALERT` to `TaskActivityType` enum; add `lastWebhookAt`.
- `lib/repositories/member.repository.ts` — add `findByClerkUserByEmail` helper.
- `lib/services/task.service.ts` — add `createFromAutomation` and `reopen` methods.
- `app/workspace/[workspaceUrl]/components/pages/IntegrationsPage.tsx` — mount `<SentryIntegrationCard />`.
- `app/workspace/[workspaceUrl]/components/TaskActivityList.tsx` (or whichever file renders task timeline; verify during Task 27) — render `SENTRY_ALERT` activity type.
- `app/workspace/[workspaceUrl]/constants.ts` (the `API` export used by IntegrationsPage) — add `sentry` API base paths.

---

## Conventions

- **Branch name**: `lumo/<TASK-ID>-sentry-integration` (replace `<TASK-ID>` with the real Linear/GitHub task id when work begins — e.g. `LUM-42`).
- **Commit format**: `type: description [<TASK-ID>]` (e.g. `feat: add SentryIntegration prisma model [LUM-42]`).
- **Test command**: `npm test -- <path-or-pattern>` for focused runs; `npm test` for the full suite; `npx tsc --noEmit` after each commit to guarantee type safety (CLAUDE.md PR checklist).
- **Language**: code and commit messages in English; user-visible error messages in English to match existing integrations.

---

### Task 0: Create feature branch

**Files:**

- None (git metadata only)

- [ ] **Step 1: Confirm Sentry integration task id with the user (e.g. `LUM-42`)**

If running via an executor: prompt the user for the task id before creating the branch. If not provided, use `LUM-SENTRY` as a placeholder and flag it in the final PR.

- [ ] **Step 2: Create and switch to the branch**

```bash
git checkout -b lumo/LUM-42-sentry-integration
```

- [ ] **Step 3: Verify starting state**

```bash
git status
npx tsc --noEmit
```

Expected: working tree clean; tsc exits 0.

---

### Task 1: Prisma schema — models, back-relations, enum, migration

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_sentry_integration/migration.sql` (generated)

- [ ] **Step 1: Append the new models to `prisma/schema.prisma`**

Append to the end of the file (after the last existing model):

```prisma
model SentryIntegration {
  id             String   @id @default(cuid())
  workspaceId    String   @unique
  installedBy    String?
  installer      WorkspaceMember? @relation("SentryInstaller", fields: [installedBy], references: [id], onDelete: SetNull)

  orgSlug        String   @unique
  clientSecret   String   // AES-256-GCM encrypted: "iv:authTag:ciphertext" (hex)
  lastWebhookAt  DateTime?

  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  workspace       Workspace              @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  projectMappings SentryProjectMapping[]
  issueLinks      SentryIssueLink[]

  @@index([orgSlug])
  @@map("sentry_integrations")
}

model SentryProjectMapping {
  id                String   @id @default(cuid())
  integrationId     String
  sentryProjectSlug String
  projectId         String
  createdAt         DateTime @default(now())

  integration SentryIntegration @relation(fields: [integrationId], references: [id], onDelete: Cascade)
  project     Project           @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@unique([integrationId, sentryProjectSlug])
  @@index([integrationId])
  @@index([projectId])
  @@map("sentry_project_mappings")
}

model SentryIssueLink {
  id            String   @id @default(cuid())
  integrationId String
  sentryIssueId String
  taskId        String
  createdAt     DateTime @default(now())

  integration SentryIntegration @relation(fields: [integrationId], references: [id], onDelete: Cascade)
  task        Task              @relation(fields: [taskId], references: [id], onDelete: Cascade)

  @@unique([integrationId, sentryIssueId])
  @@index([taskId])
  @@map("sentry_issue_links")
}
```

- [ ] **Step 2: Add back-relations to existing models**

In `model Workspace`, add:

```prisma
  sentryIntegration SentryIntegration?
```

In `model WorkspaceMember`, add (alongside `slackInstalled`):

```prisma
  sentryInstalled  SentryIntegration[] @relation("SentryInstaller")
```

In `model Project`, add:

```prisma
  sentryProjectMappings SentryProjectMapping[]
```

In `model Task`, add:

```prisma
  sentryIssueLinks SentryIssueLink[]
```

- [ ] **Step 3: Add enum value**

In `enum TaskActivityType`, append `SENTRY_ALERT` on its own line (order does not matter in Prisma enums, but match the file's existing alphabetical/logical ordering — put it after the last existing value).

- [ ] **Step 4: Validate the schema**

```bash
npx prisma validate
```

Expected: `The schema at prisma/schema.prisma is valid`.

- [ ] **Step 5: Generate migration**

```bash
npx prisma migrate dev --name sentry_integration --create-only
```

Expected: a new folder `prisma/migrations/<timestamp>_sentry_integration/` with `migration.sql` containing `CREATE TABLE "sentry_integrations"`, `"sentry_project_mappings"`, `"sentry_issue_links"`, and `ALTER TYPE "TaskActivityType" ADD VALUE 'SENTRY_ALERT'`.

- [ ] **Step 6: Inspect the migration SQL**

Open `migration.sql` and verify:

- Three `CREATE TABLE` statements with the exact columns from the schema.
- Unique indexes on `(workspaceId)`, `(orgSlug)`, `(integrationId, sentryProjectSlug)`, `(integrationId, sentryIssueId)`.
- `ON DELETE CASCADE` on all foreign keys except `installedBy` (which is `ON DELETE SET NULL`).
- The enum ALTER uses `ADD VALUE 'SENTRY_ALERT'` (not dropping/recreating the type).

- [ ] **Step 7: Apply migration**

```bash
npx prisma migrate dev
```

Expected: migration applied; `prisma generate` runs automatically; no errors.

- [ ] **Step 8: Typecheck**

```bash
npx tsc --noEmit
```

Expected: exit 0. The generated Prisma client now knows `prisma.sentryIntegration`, etc.

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add Sentry integration prisma models [LUM-42]"
```

---

### Task 2: Sentry fixtures + shared types

**Files:**

- Create: `__tests__/fixtures/sentry-issue-alert.json`
- Create: `__tests__/fixtures/sentry-issue-alert-regression.json`
- Create: `lib/integrations/sentry/types.ts`

- [ ] **Step 1: Create the happy-path fixture**

Based on Sentry's public docs for issue alert webhooks (`https://docs.sentry.io/organization/integrations/integration-platform/webhooks/issue-alerts/`). Create `__tests__/fixtures/sentry-issue-alert.json` with the following content:

```json
{
  "action": "triggered",
  "installation": { "uuid": "11111111-1111-1111-1111-111111111111" },
  "data": {
    "event": {
      "event_id": "ffffffffffffffffffffffffffffffff",
      "project": 1,
      "release": "frontend@1.2.3",
      "dist": null,
      "platform": "javascript",
      "message": "",
      "datetime": "2026-04-16T09:15:30.000Z",
      "tags": [
        ["level", "error"],
        ["browser", "Chrome 124.0"]
      ],
      "culprit": "renderDashboard(app/dashboard/page.tsx)",
      "issue_id": "4555555555",
      "issue_url": "https://sentry.io/api/0/issues/4555555555/",
      "url": "https://sentry.io/api/0/projects/acme-inc/frontend/events/ffffffffffffffffffffffffffffffff/",
      "web_url": "https://acme-inc.sentry.io/issues/4555555555/",
      "level": "error",
      "title": "TypeError: Cannot read properties of undefined (reading 'map')",
      "metadata": {
        "type": "TypeError",
        "value": "Cannot read properties of undefined (reading 'map')",
        "filename": "app/dashboard/page.tsx",
        "function": "renderDashboard"
      },
      "entries": [
        {
          "type": "exception",
          "data": {
            "values": [
              {
                "type": "TypeError",
                "value": "Cannot read properties of undefined (reading 'map')",
                "stacktrace": {
                  "frames": [
                    {
                      "function": "handleRequest",
                      "filename": "app/api/route.ts",
                      "lineno": 12
                    },
                    {
                      "function": "fetchData",
                      "filename": "lib/api-client/tasks.ts",
                      "lineno": 48
                    },
                    {
                      "function": "renderDashboard",
                      "filename": "app/dashboard/page.tsx",
                      "lineno": 87
                    }
                  ]
                }
              }
            ]
          }
        }
      ],
      "project_slug": "frontend",
      "suggestedOwners": [
        {
          "owner": {
            "type": "user",
            "id": "12345",
            "name": "Ada Lovelace",
            "email": "ada@example.com"
          },
          "rules": [["codeowners", "app/dashboard/**"]]
        }
      ]
    },
    "triggered_rule": "High-priority JS errors",
    "issue_alert": {
      "id": "999",
      "title": "High-priority JS errors"
    }
  },
  "actor": { "type": "application", "id": "sentry", "name": "Sentry" }
}
```

> **Important:** Sentry's payload nests project slug inside `data.event.project_slug` _and_ inside `data.event.entries`/`data.event.url` path segments. Our code uses `data.event.project_slug`. Also note that `data.event.issue_id` is the stable key we deduplicate by.

- [ ] **Step 2: Create the regression fixture**

Copy the happy-path file and edit:

- `"action": "resolved"` (regressions are often modelled as `resolved` actions in Sentry's event stream; fixture is used in tests that simulate "same issue_id arrives again")
- Bump `datetime` by an hour
- Change `issue_alert.title` to `"Regression: frontend errors"`

Save as `__tests__/fixtures/sentry-issue-alert-regression.json`.

- [ ] **Step 3: Create `lib/integrations/sentry/types.ts`**

```typescript
/**
 * Types for Sentry Internal Integration webhook payloads.
 * Reference: https://docs.sentry.io/organization/integrations/integration-platform/webhooks/
 */

export type SentryLevel = 'fatal' | 'error' | 'warning' | 'info' | 'debug'

export interface SentryStackFrame {
  function?: string
  filename?: string
  lineno?: number
  colno?: number
}

export interface SentrySuggestedOwner {
  owner?: {
    type?: 'user' | 'team'
    id?: string
    name?: string
    email?: string
  }
  rules?: unknown
}

export interface SentryIssueAlertPayload {
  action: string
  installation?: { uuid?: string }
  data: {
    event: {
      issue_id?: string
      issue_url?: string
      web_url?: string
      url?: string
      project_slug?: string
      title?: string
      culprit?: string
      level?: SentryLevel | string
      datetime?: string
      metadata?: {
        type?: string
        value?: string
        filename?: string
        function?: string
      }
      entries?: Array<{
        type: string
        data?: {
          values?: Array<{
            stacktrace?: { frames?: SentryStackFrame[] }
          }>
        }
      }>
      suggestedOwners?: SentrySuggestedOwner[]
      count?: number | string
      firstSeen?: string
      lastSeen?: string
    }
    triggered_rule?: string
    issue_alert?: { id?: string; title?: string }
  }
  actor?: { type?: string; id?: string; name?: string; email?: string }
}

export interface ExtractedIssueFields {
  sentryIssueId: string
  sentryProjectSlug: string
  title: string
  culprit: string | null
  level: SentryLevel
  webUrl: string
  eventCount: number | null
  firstSeen: string | null
  lastSeen: string | null
  stackFrames: SentryStackFrame[]
  triggeredRule: string | null
}
```

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add __tests__/fixtures/sentry-issue-alert.json __tests__/fixtures/sentry-issue-alert-regression.json lib/integrations/sentry/types.ts
git commit -m "chore: add Sentry webhook fixtures and types [LUM-42]"
```

---

### Task 3: `verifySentrySignature` + tests

**Files:**

- Create: `lib/integrations/sentry/verify.ts`
- Create: `__tests__/lib/integrations/sentry/verify.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/integrations/sentry/verify.test.ts`:

```typescript
import { createHmac } from 'crypto'
import { verifySentrySignature } from '@/lib/integrations/sentry/verify'

const SECRET = 'test-client-secret'
const BODY = '{"hello":"world"}'
const VALID_SIG = createHmac('sha256', SECRET)
  .update(BODY, 'utf8')
  .digest('hex')

describe('verifySentrySignature', () => {
  it('returns true for a correctly signed body', () => {
    expect(verifySentrySignature(BODY, VALID_SIG, SECRET)).toBe(true)
  })

  it('returns false when signature header is missing', () => {
    expect(verifySentrySignature(BODY, null, SECRET)).toBe(false)
  })

  it('returns false when signature is wrong', () => {
    expect(verifySentrySignature(BODY, 'deadbeef', SECRET)).toBe(false)
  })

  it('returns false when body is tampered', () => {
    expect(verifySentrySignature(BODY + ' ', VALID_SIG, SECRET)).toBe(false)
  })

  it('returns false when secret is wrong', () => {
    expect(verifySentrySignature(BODY, VALID_SIG, 'other-secret')).toBe(false)
  })

  it('returns false when signature is malformed (non-hex)', () => {
    expect(verifySentrySignature(BODY, 'not-a-hex-string', SECRET)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- __tests__/lib/integrations/sentry/verify.test.ts
```

Expected: FAIL — "Cannot find module '@/lib/integrations/sentry/verify'".

- [ ] **Step 3: Create `lib/integrations/sentry/verify.ts`**

```typescript
import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Verifies a Sentry Internal Integration webhook HMAC-SHA256 signature.
 *
 * Sentry sends the raw hex digest (no "sha256=" prefix) in the
 * `sentry-hook-signature` header.
 *
 * @param body            - Raw request body as a UTF-8 string
 * @param signatureHeader - Value of the sentry-hook-signature header (hex)
 * @param secret          - Client secret from the Sentry Internal Integration
 */
export function verifySentrySignature(
  body: string,
  signatureHeader: string | null,
  secret: string
): boolean {
  if (!signatureHeader) return false
  const expected = createHmac('sha256', secret)
    .update(body, 'utf8')
    .digest('hex')
  try {
    const a = Buffer.from(signatureHeader, 'hex')
    const b = Buffer.from(expected, 'hex')
    if (a.length !== b.length || a.length === 0) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- __tests__/lib/integrations/sentry/verify.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/integrations/sentry/verify.ts __tests__/lib/integrations/sentry/verify.test.ts
git commit -m "feat: add Sentry webhook signature verifier [LUM-42]"
```

---

### Task 4: `mapLevelToPriority` + tests

**Files:**

- Create: `lib/integrations/sentry/payload.ts` (first function only — extended in Tasks 5–7)
- Create: `__tests__/lib/integrations/sentry/payload.test.ts` (first `describe` only)

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/integrations/sentry/payload.test.ts`:

```typescript
import { mapLevelToPriority } from '@/lib/integrations/sentry/payload'

describe('mapLevelToPriority', () => {
  it('maps fatal → URGENT', () => {
    expect(mapLevelToPriority('fatal')).toBe('URGENT')
  })
  it('maps error → HIGH', () => {
    expect(mapLevelToPriority('error')).toBe('HIGH')
  })
  it('maps warning → MEDIUM', () => {
    expect(mapLevelToPriority('warning')).toBe('MEDIUM')
  })
  it('maps info → LOW', () => {
    expect(mapLevelToPriority('info')).toBe('LOW')
  })
  it('maps debug → LOW', () => {
    expect(mapLevelToPriority('debug')).toBe('LOW')
  })
  it('maps unknown → LOW', () => {
    expect(mapLevelToPriority('something-new')).toBe('LOW')
  })
  it('maps undefined → LOW', () => {
    expect(mapLevelToPriority(undefined)).toBe('LOW')
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- __tests__/lib/integrations/sentry/payload.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `lib/integrations/sentry/payload.ts`**

```typescript
import type { TaskPriority } from '@prisma/client'

/**
 * Map a Sentry level string to a Lumo TaskPriority.
 * Unknown / missing levels → LOW.
 */
export function mapLevelToPriority(
  level: string | undefined | null
): TaskPriority {
  switch (level) {
    case 'fatal':
      return 'URGENT'
    case 'error':
      return 'HIGH'
    case 'warning':
      return 'MEDIUM'
    default:
      return 'LOW'
  }
}
```

- [ ] **Step 4: Run to verify pass**

```bash
npm test -- __tests__/lib/integrations/sentry/payload.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/integrations/sentry/payload.ts __tests__/lib/integrations/sentry/payload.test.ts
git commit -m "feat: add Sentry level→priority mapper [LUM-42]"
```

---

### Task 5: `pickSuggestedOwnerEmails` + tests

**Files:**

- Modify: `lib/integrations/sentry/payload.ts`
- Modify: `__tests__/lib/integrations/sentry/payload.test.ts`

- [ ] **Step 1: Append failing test to the existing test file**

Add to `__tests__/lib/integrations/sentry/payload.test.ts`:

```typescript
import { pickSuggestedOwnerEmails } from '@/lib/integrations/sentry/payload'
import type { SentryIssueAlertPayload } from '@/lib/integrations/sentry/types'

function makePayload(
  overrides: Partial<SentryIssueAlertPayload['data']['event']> = {}
): SentryIssueAlertPayload {
  return {
    action: 'triggered',
    data: {
      event: {
        project_slug: 'frontend',
        issue_id: '42',
        title: 't',
        level: 'error',
        web_url: 'https://example.com',
        ...overrides,
      },
    },
  }
}

describe('pickSuggestedOwnerEmails', () => {
  it('returns user emails in order', () => {
    const payload = makePayload({
      suggestedOwners: [
        { owner: { type: 'user', email: 'a@example.com' } },
        { owner: { type: 'team', email: 'team@example.com' } },
        { owner: { type: 'user', email: 'b@example.com' } },
      ],
    })
    expect(pickSuggestedOwnerEmails(payload)).toEqual([
      'a@example.com',
      'b@example.com',
    ])
  })

  it('falls back to actor.email when suggestedOwners is missing', () => {
    const payload: SentryIssueAlertPayload = {
      action: 'triggered',
      actor: { type: 'user', email: 'fallback@example.com' },
      data: {
        event: {
          project_slug: 'frontend',
          issue_id: '42',
          title: 't',
          level: 'error',
          web_url: 'https://example.com',
        },
      },
    }
    expect(pickSuggestedOwnerEmails(payload)).toEqual(['fallback@example.com'])
  })

  it('returns empty array when no owners and no actor email', () => {
    expect(pickSuggestedOwnerEmails(makePayload())).toEqual([])
  })

  it('skips owners with no email', () => {
    const payload = makePayload({
      suggestedOwners: [
        { owner: { type: 'user' } },
        { owner: { type: 'user', email: 'c@example.com' } },
      ],
    })
    expect(pickSuggestedOwnerEmails(payload)).toEqual(['c@example.com'])
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- __tests__/lib/integrations/sentry/payload.test.ts
```

Expected: FAIL — `pickSuggestedOwnerEmails is not exported`.

- [ ] **Step 3: Append to `lib/integrations/sentry/payload.ts`**

```typescript
import type { SentryIssueAlertPayload } from './types'

/**
 * Extract usable email candidates for assignee matching, in priority order:
 *   1. suggestedOwners entries whose owner.type === 'user' and have email
 *   2. fallback to the top-level actor.email (if present)
 */
export function pickSuggestedOwnerEmails(
  payload: SentryIssueAlertPayload
): string[] {
  const fromOwners = (payload.data.event.suggestedOwners ?? [])
    .filter(o => o.owner?.type === 'user' && !!o.owner?.email)
    .map(o => o.owner!.email!)

  if (fromOwners.length > 0) return fromOwners

  const actorEmail = payload.actor?.email
  return actorEmail ? [actorEmail] : []
}
```

- [ ] **Step 4: Run to verify pass**

```bash
npm test -- __tests__/lib/integrations/sentry/payload.test.ts
```

Expected: PASS (all tests, 7 + 4 = 11).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/integrations/sentry/payload.ts __tests__/lib/integrations/sentry/payload.test.ts
git commit -m "feat: add Sentry suggested owners email picker [LUM-42]"
```

---

### Task 6: `extractIssueFields` + tests

**Files:**

- Modify: `lib/integrations/sentry/payload.ts`
- Modify: `__tests__/lib/integrations/sentry/payload.test.ts`

- [ ] **Step 1: Append failing test**

Add to `__tests__/lib/integrations/sentry/payload.test.ts`:

```typescript
import { extractIssueFields } from '@/lib/integrations/sentry/payload'
import alertFixture from '@/__tests__/fixtures/sentry-issue-alert.json'
import type { SentryIssueAlertPayload } from '@/lib/integrations/sentry/types'

describe('extractIssueFields', () => {
  const fixture = alertFixture as unknown as SentryIssueAlertPayload

  it('extracts fields from the happy-path fixture', () => {
    const fields = extractIssueFields(fixture)
    expect(fields).toMatchObject({
      sentryIssueId: '4555555555',
      sentryProjectSlug: 'frontend',
      title: "TypeError: Cannot read properties of undefined (reading 'map')",
      culprit: 'renderDashboard(app/dashboard/page.tsx)',
      level: 'error',
      webUrl: 'https://acme-inc.sentry.io/issues/4555555555/',
      triggeredRule: 'High-priority JS errors',
    })
    expect(fields.stackFrames.length).toBeGreaterThan(0)
  })

  it('returns null for missing optional fields', () => {
    const minimal: SentryIssueAlertPayload = {
      action: 'triggered',
      data: {
        event: {
          project_slug: 'x',
          issue_id: '1',
          title: 'Err',
          web_url: 'https://example.com/issues/1',
        },
      },
    }
    const fields = extractIssueFields(minimal)
    expect(fields.culprit).toBeNull()
    expect(fields.triggeredRule).toBeNull()
    expect(fields.stackFrames).toEqual([])
    expect(fields.level).toBe('info') // default
  })

  it('truncates title to 200 chars', () => {
    const long = 'x'.repeat(500)
    const fields = extractIssueFields({
      action: 't',
      data: {
        event: {
          project_slug: 'x',
          issue_id: '1',
          title: long,
          web_url: 'https://example.com',
        },
      },
    } as SentryIssueAlertPayload)
    expect(fields.title).toHaveLength(200)
  })

  it('throws when sentryIssueId is absent', () => {
    expect(() =>
      extractIssueFields({
        action: 't',
        data: {
          event: {
            project_slug: 'x',
            title: 't',
            web_url: 'https://example.com',
          },
        },
      } as SentryIssueAlertPayload)
    ).toThrow(/issue_id/)
  })

  it('throws when sentryProjectSlug is absent', () => {
    expect(() =>
      extractIssueFields({
        action: 't',
        data: {
          event: {
            issue_id: '1',
            title: 't',
            web_url: 'https://example.com',
          },
        },
      } as SentryIssueAlertPayload)
    ).toThrow(/project_slug/)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- __tests__/lib/integrations/sentry/payload.test.ts
```

Expected: FAIL — `extractIssueFields is not exported`.

- [ ] **Step 3: Append to `lib/integrations/sentry/payload.ts`**

```typescript
import type {
  ExtractedIssueFields,
  SentryLevel,
  SentryStackFrame,
} from './types'

const DEFAULT_LEVEL: SentryLevel = 'info'

/**
 * Pull the issue-level fields we care about out of a Sentry webhook payload.
 * Throws if the two strictly-required identifiers (issue_id + project_slug)
 * are missing — those are the dedup key and routing key.
 */
export function extractIssueFields(
  payload: SentryIssueAlertPayload
): ExtractedIssueFields {
  const ev = payload.data.event

  const sentryIssueId = ev.issue_id
  if (!sentryIssueId) {
    throw new Error('Sentry payload missing data.event.issue_id')
  }
  const sentryProjectSlug = ev.project_slug
  if (!sentryProjectSlug) {
    throw new Error('Sentry payload missing data.event.project_slug')
  }

  const title = (ev.title ?? '(untitled Sentry issue)').slice(0, 200)
  const webUrl = ev.web_url ?? ev.issue_url ?? ''
  const level = (ev.level as SentryLevel | undefined) ?? DEFAULT_LEVEL

  const stackFrames: SentryStackFrame[] = (() => {
    const values = ev.entries?.find(e => e.type === 'exception')?.data?.values
    const frames = values?.[0]?.stacktrace?.frames
    return frames ?? []
  })()

  const eventCountRaw = ev.count
  const eventCount =
    typeof eventCountRaw === 'number'
      ? eventCountRaw
      : typeof eventCountRaw === 'string' && eventCountRaw.trim() !== ''
        ? Number.parseInt(eventCountRaw, 10) || null
        : null

  return {
    sentryIssueId,
    sentryProjectSlug,
    title,
    culprit: ev.culprit ?? null,
    level,
    webUrl,
    eventCount,
    firstSeen: ev.firstSeen ?? null,
    lastSeen: ev.lastSeen ?? null,
    stackFrames,
    triggeredRule: payload.data.triggered_rule ?? null,
  }
}
```

- [ ] **Step 4: Run to verify pass**

```bash
npm test -- __tests__/lib/integrations/sentry/payload.test.ts
```

Expected: PASS (all tests in the file).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/integrations/sentry/payload.ts __tests__/lib/integrations/sentry/payload.test.ts
git commit -m "feat: add Sentry issue field extractor [LUM-42]"
```

---

### Task 7: `buildTaskDescription` + tests

**Files:**

- Modify: `lib/integrations/sentry/payload.ts`
- Modify: `__tests__/lib/integrations/sentry/payload.test.ts`

- [ ] **Step 1: Append failing test**

Add to `__tests__/lib/integrations/sentry/payload.test.ts`:

````typescript
import { buildTaskDescription } from '@/lib/integrations/sentry/payload'
import type { ExtractedIssueFields } from '@/lib/integrations/sentry/types'

function fields(
  overrides: Partial<ExtractedIssueFields> = {}
): ExtractedIssueFields {
  return {
    sentryIssueId: '1',
    sentryProjectSlug: 'frontend',
    title: 'Boom',
    culprit: 'renderThing',
    level: 'error',
    webUrl: 'https://example.com/issues/1',
    eventCount: 42,
    firstSeen: '2026-04-16T00:00:00.000Z',
    lastSeen: '2026-04-16T09:15:30.000Z',
    stackFrames: [
      { function: 'a', filename: 'a.ts', lineno: 1 },
      { function: 'b', filename: 'b.ts', lineno: 2 },
      { function: 'c', filename: 'c.ts', lineno: 3 },
    ],
    triggeredRule: null,
    ...overrides,
  }
}

describe('buildTaskDescription', () => {
  it('produces markdown with all sections', () => {
    const md = buildTaskDescription(fields())
    expect(md).toMatch(
      /\*\*Sentry issue:\*\* \[Boom\]\(https:\/\/example\.com\/issues\/1\)/
    )
    expect(md).toMatch(/\*\*Culprit:\*\* `renderThing`/)
    expect(md).toMatch(/\*\*Level:\*\* `error`/)
    expect(md).toMatch(/\*\*Events:\*\* 42/)
    expect(md).toContain('First seen: 2026-04-16T00:00:00.000Z')
    expect(md).toContain('Last seen: 2026-04-16T09:15:30.000Z')
    expect(md).toContain('at a (a.ts:1)')
    expect(md).toContain('at c (c.ts:3)')
    expect(md).toContain('_Created automatically from Sentry alert._')
  })

  it('omits stack block when there are no frames', () => {
    const md = buildTaskDescription(fields({ stackFrames: [] }))
    expect(md).not.toContain('**Stack')
    expect(md).not.toContain('```')
  })

  it('truncates to 5 frames, innermost first', () => {
    const manyFrames = Array.from({ length: 10 }, (_, i) => ({
      function: `fn${i}`,
      filename: 'x.ts',
      lineno: i,
    }))
    const md = buildTaskDescription(fields({ stackFrames: manyFrames }))
    // Sentry sends outermost-first; we reverse and take first 5.
    expect(md).toContain('at fn9 (x.ts:9)')
    expect(md).toContain('at fn5 (x.ts:5)')
    expect(md).not.toContain('at fn4 (x.ts:4)')
  })

  it('truncates stack lines longer than 200 chars', () => {
    const longFn = 'f'.repeat(500)
    const md = buildTaskDescription(
      fields({
        stackFrames: [{ function: longFn, filename: 'x.ts', lineno: 1 }],
      })
    )
    const stackLine = md.split('\n').find(l => l.includes('at '))!
    expect(stackLine.length).toBeLessThanOrEqual(200)
  })

  it('gracefully handles missing optional fields', () => {
    const md = buildTaskDescription(
      fields({
        culprit: null,
        eventCount: null,
        firstSeen: null,
        lastSeen: null,
      })
    )
    expect(md).not.toContain('**Culprit:**')
    expect(md).not.toContain('**Events:**')
    expect(md).not.toContain('First seen:')
  })
})
````

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- __tests__/lib/integrations/sentry/payload.test.ts
```

Expected: FAIL — `buildTaskDescription is not exported`.

- [ ] **Step 3: Append to `lib/integrations/sentry/payload.ts`**

````typescript
const MAX_STACK_FRAMES = 5
const MAX_LINE_LEN = 200

/**
 * Build a Markdown task description from extracted Sentry fields.
 */
export function buildTaskDescription(fields: ExtractedIssueFields): string {
  const lines: string[] = []

  lines.push(`**Sentry issue:** [${fields.title}](${fields.webUrl})`)
  lines.push('')

  if (fields.culprit) {
    lines.push(`**Culprit:** \`${fields.culprit}\``)
  }
  lines.push(`**Level:** \`${fields.level}\``)

  const meta: string[] = []
  if (fields.eventCount !== null) meta.push(`**Events:** ${fields.eventCount}`)
  if (fields.firstSeen) meta.push(`First seen: ${fields.firstSeen}`)
  if (fields.lastSeen) meta.push(`Last seen: ${fields.lastSeen}`)
  if (meta.length > 0) lines.push(meta.join(' · '))

  if (fields.stackFrames.length > 0) {
    lines.push('')
    lines.push('**Stack (top 5 frames):**')
    lines.push('```')
    const frames = [...fields.stackFrames].reverse().slice(0, MAX_STACK_FRAMES)
    for (const f of frames) {
      const fn = f.function ?? '<anonymous>'
      const file = f.filename ?? '<unknown>'
      const ln = f.lineno ?? 0
      let line = `  at ${fn} (${file}:${ln})`
      if (line.length > MAX_LINE_LEN) {
        line = line.slice(0, MAX_LINE_LEN - 3) + '...'
      }
      lines.push(line)
    }
    lines.push('```')
  }

  lines.push('')
  lines.push('_Created automatically from Sentry alert._')

  return lines.join('\n')
}
````

- [ ] **Step 4: Run to verify pass**

```bash
npm test -- __tests__/lib/integrations/sentry/payload.test.ts
```

Expected: PASS (all tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/integrations/sentry/payload.ts __tests__/lib/integrations/sentry/payload.test.ts
git commit -m "feat: add Sentry task description builder [LUM-42]"
```

---

### Task 8: Sentry barrel file (`index.ts`)

**Files:**

- Create: `lib/integrations/sentry/index.ts`

- [ ] **Step 1: Create `lib/integrations/sentry/index.ts`**

```typescript
/**
 * Public API for the Sentry integration module.
 *
 * All external code must import from this barrel — never from internal files
 * like `@/lib/integrations/sentry/payload` directly.
 */

// Types
export type {
  SentryLevel,
  SentryStackFrame,
  SentrySuggestedOwner,
  SentryIssueAlertPayload,
  ExtractedIssueFields,
} from './types'

// Signature verification
export { verifySentrySignature } from './verify'

// Payload helpers
export {
  mapLevelToPriority,
  pickSuggestedOwnerEmails,
  extractIssueFields,
  buildTaskDescription,
} from './payload'
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add lib/integrations/sentry/index.ts
git commit -m "feat: export Sentry integration barrel [LUM-42]"
```

---

### Task 9: `sentryRepository` + tests

**Files:**

- Create: `lib/repositories/sentry.repository.ts`
- Create: `__tests__/lib/repositories/sentry.repository.test.ts`

- [ ] **Step 1: Write the failing test**

Look at `__tests__/lib/repositories/` or `__tests__/invite.repository.test.ts` for the established mocking pattern. Use the same shape: mock `@/lib/db/prisma` and assert the repository calls the right Prisma methods with the right arguments.

Create `__tests__/lib/repositories/sentry.repository.test.ts`:

```typescript
import { sentryRepository } from '@/lib/repositories/sentry.repository'
import { prisma } from '@/lib/db/prisma'

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    sentryIntegration: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
    },
    sentryProjectMapping: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    sentryIssueLink: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  },
}))

const mocked = prisma as unknown as Record<string, Record<string, jest.Mock>>

beforeEach(() => {
  Object.values(mocked).forEach(model =>
    Object.values(model).forEach(fn => fn.mockReset())
  )
})

describe('sentryRepository', () => {
  describe('findIntegrationByWorkspace', () => {
    it('queries by workspaceId with safe selection', async () => {
      mocked.sentryIntegration.findUnique.mockResolvedValue({
        id: 'int1',
        orgSlug: 'acme',
        lastWebhookAt: null,
      })
      const result = await sentryRepository.findIntegrationByWorkspace('ws1')
      expect(mocked.sentryIntegration.findUnique).toHaveBeenCalledWith({
        where: { workspaceId: 'ws1' },
        select: {
          id: true,
          orgSlug: true,
          lastWebhookAt: true,
          installedBy: true,
        },
      })
      expect(result?.orgSlug).toBe('acme')
    })
  })

  describe('findIntegrationByOrgSlug', () => {
    it('returns id + clientSecret + workspaceId for signature check', async () => {
      mocked.sentryIntegration.findUnique.mockResolvedValue({
        id: 'int1',
        workspaceId: 'ws1',
        clientSecret: 'encrypted',
      })
      const result = await sentryRepository.findIntegrationByOrgSlug('acme')
      expect(mocked.sentryIntegration.findUnique).toHaveBeenCalledWith({
        where: { orgSlug: 'acme' },
        select: { id: true, workspaceId: true, clientSecret: true },
      })
      expect(result?.id).toBe('int1')
    })
  })

  describe('upsertIntegration', () => {
    it('upserts by workspaceId with encrypted secret', async () => {
      mocked.sentryIntegration.upsert.mockResolvedValue({ id: 'int1' })
      await sentryRepository.upsertIntegration({
        workspaceId: 'ws1',
        installedBy: 'mem1',
        orgSlug: 'acme',
        clientSecret: 'enc',
      })
      const arg = mocked.sentryIntegration.upsert.mock.calls[0][0]
      expect(arg.where).toEqual({ workspaceId: 'ws1' })
      expect(arg.create.orgSlug).toBe('acme')
      expect(arg.update.clientSecret).toBe('enc')
    })
  })

  describe('findMappingByProjectSlug', () => {
    it('queries the composite unique index', async () => {
      mocked.sentryProjectMapping.findUnique.mockResolvedValue({
        id: 'map1',
        projectId: 'proj1',
      })
      await sentryRepository.findMappingByProjectSlug('int1', 'frontend')
      expect(mocked.sentryProjectMapping.findUnique).toHaveBeenCalledWith({
        where: {
          integrationId_sentryProjectSlug: {
            integrationId: 'int1',
            sentryProjectSlug: 'frontend',
          },
        },
        select: { id: true, projectId: true, integrationId: true },
      })
    })
  })

  describe('findLink', () => {
    it('queries the link composite unique index', async () => {
      mocked.sentryIssueLink.findUnique.mockResolvedValue({
        id: 'link1',
        taskId: 'task1',
      })
      await sentryRepository.findLink('int1', 'iss1')
      expect(mocked.sentryIssueLink.findUnique).toHaveBeenCalledWith({
        where: {
          integrationId_sentryIssueId: {
            integrationId: 'int1',
            sentryIssueId: 'iss1',
          },
        },
        select: { id: true, taskId: true },
      })
    })
  })

  describe('markWebhookReceived', () => {
    it('updates lastWebhookAt', async () => {
      mocked.sentryIntegration.update.mockResolvedValue({})
      await sentryRepository.markWebhookReceived('int1')
      expect(mocked.sentryIntegration.update).toHaveBeenCalledWith({
        where: { id: 'int1' },
        data: { lastWebhookAt: expect.any(Date) },
        select: { id: true },
      })
    })
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- __tests__/lib/repositories/sentry.repository.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `lib/repositories/sentry.repository.ts`**

```typescript
import { prisma } from '@/lib/db/prisma'

export interface UpsertSentryIntegrationData {
  workspaceId: string
  installedBy: string
  orgSlug: string
  clientSecret: string // already encrypted
}

export interface CreateSentryProjectMappingData {
  integrationId: string
  sentryProjectSlug: string
  projectId: string
}

export const sentryRepository = {
  // ── Integration ──────────────────────────────────────────────────────
  async findIntegrationByWorkspace(workspaceId: string) {
    return prisma.sentryIntegration.findUnique({
      where: { workspaceId },
      select: {
        id: true,
        orgSlug: true,
        lastWebhookAt: true,
        installedBy: true,
      },
    })
  },

  async findIntegrationByOrgSlug(orgSlug: string) {
    return prisma.sentryIntegration.findUnique({
      where: { orgSlug },
      select: { id: true, workspaceId: true, clientSecret: true },
    })
  },

  async upsertIntegration(data: UpsertSentryIntegrationData) {
    return prisma.sentryIntegration.upsert({
      where: { workspaceId: data.workspaceId },
      create: {
        workspaceId: data.workspaceId,
        installedBy: data.installedBy,
        orgSlug: data.orgSlug,
        clientSecret: data.clientSecret,
      },
      update: {
        installedBy: data.installedBy,
        orgSlug: data.orgSlug,
        clientSecret: data.clientSecret,
      },
      select: { id: true },
    })
  },

  async deleteIntegration(workspaceId: string) {
    return prisma.sentryIntegration.delete({ where: { workspaceId } })
  },

  async markWebhookReceived(integrationId: string) {
    return prisma.sentryIntegration.update({
      where: { id: integrationId },
      data: { lastWebhookAt: new Date() },
      select: { id: true },
    })
  },

  // ── Mappings ────────────────────────────────────────────────────────
  async listMappings(integrationId: string) {
    return prisma.sentryProjectMapping.findMany({
      where: { integrationId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        sentryProjectSlug: true,
        projectId: true,
        project: { select: { id: true, name: true } },
      },
    })
  },

  async findMappingByProjectSlug(
    integrationId: string,
    sentryProjectSlug: string
  ) {
    return prisma.sentryProjectMapping.findUnique({
      where: {
        integrationId_sentryProjectSlug: { integrationId, sentryProjectSlug },
      },
      select: { id: true, projectId: true, integrationId: true },
    })
  },

  async createMapping(data: CreateSentryProjectMappingData) {
    return prisma.sentryProjectMapping.create({
      data,
      select: {
        id: true,
        sentryProjectSlug: true,
        projectId: true,
      },
    })
  },

  async deleteMapping(id: string) {
    return prisma.sentryProjectMapping.delete({ where: { id } })
  },

  async findMappingWithIntegration(id: string) {
    return prisma.sentryProjectMapping.findUnique({
      where: { id },
      include: { integration: { select: { workspaceId: true } } },
    })
  },

  // ── Links ────────────────────────────────────────────────────────────
  async findLink(integrationId: string, sentryIssueId: string) {
    return prisma.sentryIssueLink.findUnique({
      where: {
        integrationId_sentryIssueId: { integrationId, sentryIssueId },
      },
      select: { id: true, taskId: true },
    })
  },

  async createLink(data: {
    integrationId: string
    sentryIssueId: string
    taskId: string
  }) {
    return prisma.sentryIssueLink.create({
      data,
      select: { id: true, taskId: true },
    })
  },

  // ── Project validation ───────────────────────────────────────────────
  async findProjectInWorkspace(projectId: string, workspaceId: string) {
    return prisma.project.findFirst({
      where: { id: projectId, workspaceId },
      select: { id: true },
    })
  },
}
```

- [ ] **Step 4: Run to verify pass**

```bash
npm test -- __tests__/lib/repositories/sentry.repository.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/repositories/sentry.repository.ts __tests__/lib/repositories/sentry.repository.test.ts
git commit -m "feat: add Sentry repository [LUM-42]"
```

---

### Task 10: `memberRepository.findByClerkEmailInWorkspace` (Clerk-backed email lookup)

Lumo's `WorkspaceMember` does not store email — email lives on the Clerk user. So we resolve by calling Clerk's `getUserList({ emailAddress: [...] })` to get `clerkId`s, then reusing the existing `findByWorkspaceAndClerkIds`.

**Files:**

- Modify: `lib/repositories/member.repository.ts`
- Modify: `__tests__/member.repository.test.ts`

- [ ] **Step 1: Inspect the existing test file**

Open `__tests__/member.repository.test.ts` and look at the import structure. Confirm whether Clerk is already mocked (if so, extend the mock; if not, add one).

- [ ] **Step 2: Write the failing test**

Append to `__tests__/member.repository.test.ts` (adjust the `jest.mock` setup based on what you find):

```typescript
describe('findActorsByEmailInWorkspace', () => {
  const createClerkClientMock = jest.fn()

  beforeAll(() => {
    jest.mock('@clerk/nextjs/server', () => ({
      createClerkClient: (...args: unknown[]) => createClerkClientMock(...args),
    }))
  })

  beforeEach(() => {
    createClerkClientMock.mockReset()
  })

  it('returns actor ids for matching emails within the workspace', async () => {
    // Arrange: Clerk returns a user matching the email
    createClerkClientMock.mockReturnValue({
      users: {
        getUserList: jest.fn().mockResolvedValue({
          data: [
            {
              id: 'clerk-1',
              emailAddresses: [{ emailAddress: 'ada@example.com' }],
            },
          ],
        }),
      },
    })
    // And prisma returns a member for that clerkId
    ;(prisma.workspaceMember.findMany as jest.Mock).mockResolvedValue([
      { clerkId: 'clerk-1', actor: { id: 'actor-1' } },
    ])

    const { memberRepository } =
      await import('@/lib/repositories/member.repository')
    const ids = await memberRepository.findActorsByEmailInWorkspace('ws1', [
      'ada@example.com',
    ])
    expect(ids).toEqual(['actor-1'])
  })

  it('returns empty array when no email matches', async () => {
    createClerkClientMock.mockReturnValue({
      users: { getUserList: jest.fn().mockResolvedValue({ data: [] }) },
    })
    const { memberRepository } =
      await import('@/lib/repositories/member.repository')
    const ids = await memberRepository.findActorsByEmailInWorkspace('ws1', [
      'x@example.com',
    ])
    expect(ids).toEqual([])
  })

  it('returns empty array when no emails are provided', async () => {
    const { memberRepository } =
      await import('@/lib/repositories/member.repository')
    const ids = await memberRepository.findActorsByEmailInWorkspace('ws1', [])
    expect(ids).toEqual([])
  })
})
```

> If the existing test file's prisma mock differs, match it.

- [ ] **Step 3: Run to verify failure**

```bash
npm test -- __tests__/member.repository.test.ts
```

Expected: FAIL — method doesn't exist.

- [ ] **Step 4: Extend `lib/repositories/member.repository.ts`**

Add at the bottom of the `memberRepository` object:

```typescript
  /**
   * Resolve a list of emails to Actor IDs within a workspace.
   * Flow: emails → Clerk user IDs → WorkspaceMember records → Actor IDs.
   * Preserves the input order of matched emails. Silently skips emails
   * with no Clerk user or no workspace membership.
   */
  async findActorsByEmailInWorkspace(
    workspaceId: string,
    emails: string[]
  ): Promise<string[]> {
    if (emails.length === 0) return []

    const { createClerkClient } = await import('@clerk/nextjs/server')
    const clerk = createClerkClient({
      secretKey: process.env.CLERK_SECRET_KEY!,
    })

    const { data: users } = await clerk.users.getUserList({
      emailAddress: emails,
      limit: Math.min(emails.length * 2, 100),
    })

    // Map email → clerkId (preserve input order)
    const emailToClerkId = new Map<string, string>()
    for (const user of users) {
      for (const ea of user.emailAddresses) {
        if (emails.includes(ea.emailAddress) && !emailToClerkId.has(ea.emailAddress)) {
          emailToClerkId.set(ea.emailAddress, user.id)
        }
      }
    }

    const orderedClerkIds = emails
      .map(e => emailToClerkId.get(e))
      .filter((id): id is string => !!id)

    if (orderedClerkIds.length === 0) return []

    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId, clerkId: { in: orderedClerkIds } },
      select: { clerkId: true, actor: { select: { id: true } } },
    })

    const clerkIdToActor = new Map<string, string>()
    for (const m of members) {
      if (m.actor?.id) clerkIdToActor.set(m.clerkId, m.actor.id)
    }

    return orderedClerkIds
      .map(id => clerkIdToActor.get(id))
      .filter((a): a is string => !!a)
  },
```

- [ ] **Step 5: Run to verify pass**

```bash
npm test -- __tests__/member.repository.test.ts
```

Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/repositories/member.repository.ts __tests__/member.repository.test.ts
git commit -m "feat: add member email→actor workspace lookup [LUM-42]"
```

---

### Task 11: `taskService.createFromAutomation` + tests

This creates a task without requiring a human actor. It delegates to `taskRepository.createWithSequence` directly, dispatches a targeted assignee notification (if any), but does NOT call `dispatchCreateTaskSideEffects` (which expects a human actor id).

**Files:**

- Modify: `lib/services/task.service.ts`
- Create: `__tests__/lib/services/task-service-automation.test.ts`

- [ ] **Step 1: Read existing `task.service.ts` top and `dispatchCreateTaskSideEffects` signature**

```bash

```

Use the Read tool on `lib/services/task.service.ts` — scan lines 1–80 for imports and the existing `taskRepository.createWithSequence` call shape (lines ~157–172). Note that `actorId`, `actorClerkId`, and `assigneeActorId` are the fields you'll need.

- [ ] **Step 2: Write the failing test**

Create `__tests__/lib/services/task-service-automation.test.ts`:

```typescript
import { taskService } from '@/lib/services/task.service'
import { projectRepository } from '@/lib/repositories/project.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { tagRepository } from '@/lib/repositories/tag.repository'

jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: { findByIdWithDefaults: jest.fn() },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findMaxOrder: jest.fn(),
    createWithSequence: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/tag.repository', () => ({
  tagRepository: { syncTaskTags: jest.fn() },
}))

describe('taskService.createFromAutomation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(projectRepository.findByIdWithDefaults as jest.Mock).mockResolvedValue({
      id: 'proj1',
      workspaceId: 'ws1',
      teamId: 'team1',
      defaultReviewer: null,
      workspace: { slug: 'acme' },
    })
    ;(taskRepository.findMaxOrder as jest.Mock).mockResolvedValue({ order: 3 })
    ;(taskRepository.createWithSequence as jest.Mock).mockResolvedValue({
      id: 'task1',
      title: 'Boom',
      teamIdentifier: 'LUM',
      number: 42,
      workspaceId: 'ws1',
    })
  })

  it('creates a task with TODO status and passes through all fields', async () => {
    const { task } = await taskService.createFromAutomation('proj1', {
      title: 'Boom',
      description: 'desc',
      priority: 'HIGH',
      assigneeActorId: 'actor1',
      tagIds: ['tag1'],
    })
    expect(task.id).toBe('task1')
    const args = (taskRepository.createWithSequence as jest.Mock).mock
      .calls[0][0]
    expect(args.status).toBe('TODO')
    expect(args.title).toBe('Boom')
    expect(args.priority).toBe('HIGH')
    expect(args.assigneeActorId).toBe('actor1')
  })

  it('syncs tag IDs when provided', async () => {
    await taskService.createFromAutomation('proj1', {
      title: 'x',
      description: null,
      priority: 'LOW',
      assigneeActorId: null,
      tagIds: ['tag1', 'tag2'],
    })
    expect(tagRepository.syncTaskTags).toHaveBeenCalledWith('task1', [
      'tag1',
      'tag2',
    ])
  })

  it('throws 404 when project is not found', async () => {
    ;(projectRepository.findByIdWithDefaults as jest.Mock).mockResolvedValue(
      null
    )
    await expect(
      taskService.createFromAutomation('missing', {
        title: 't',
        description: null,
        priority: 'LOW',
        assigneeActorId: null,
        tagIds: [],
      })
    ).rejects.toMatchObject({ status: 404 })
  })

  it(
    'does not call createWithSequence when assignee validation would fail — skipped, no assignee ref used here'
  )
})
```

- [ ] **Step 3: Run to verify failure**

```bash
npm test -- __tests__/lib/services/task-service-automation.test.ts
```

Expected: FAIL — `createFromAutomation is not a function`.

- [ ] **Step 4: Add method to `lib/services/task.service.ts`**

Inside the `taskService` object, after `createTask`, add:

```typescript
  /**
   * Create a task without a human actor — used by automated webhook-driven
   * flows (e.g. Sentry alerts). Skips the human-authored notification path
   * (`dispatchCreateTaskSideEffects`) but still associates tags. Caller is
   * responsible for any bespoke notification fan-out.
   */
  async createFromAutomation(
    projectId: string,
    input: {
      title: string
      description: string | null
      priority: TaskPriority
      assigneeActorId: string | null
      tagIds: string[]
    }
  ) {
    const project = await projectRepository.findByIdWithDefaults(projectId)
    if (!project) {
      throw Object.assign(new Error('Project not found'), { status: 404 })
    }

    const maxOrderTask = await taskRepository.findMaxOrder(projectId, null)
    const order = (maxOrderTask?.order ?? 0) + 1

    const task = await taskRepository.createWithSequence({
      projectId,
      teamId: project.teamId,
      title: input.title,
      description: input.description,
      status: 'TODO',
      priority: input.priority,
      assigneeActorId: input.assigneeActorId,
      agentStatus: null,
      reviewerActorId: null,
      parentTaskId: null,
      repositoryId: null,
      order,
      dueDate: null,
      defaultReviewerMemberId: project.defaultReviewer?.id ?? null,
    })

    if (input.tagIds.length > 0) {
      await tagRepository.syncTaskTags(task.id, input.tagIds)
    }

    return { task }
  },
```

Ensure `tagRepository` is imported at the top of the file (add if missing):

```typescript
import { tagRepository } from '@/lib/repositories/tag.repository'
```

- [ ] **Step 5: Run to verify pass**

```bash
npm test -- __tests__/lib/services/task-service-automation.test.ts
```

Expected: PASS (3 meaningful tests; the fourth is a comment placeholder — remove the placeholder `it(... , 'skipped ...')` line if Jest warns).

- [ ] **Step 6: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/services/task.service.ts __tests__/lib/services/task-service-automation.test.ts
git commit -m "feat: add taskService.createFromAutomation [LUM-42]"
```

---

### Task 12: `taskService.reopen` + tests

Used by the Sentry webhook when a regression hits a DONE task. Changes status back to TODO and records a `SENTRY_ALERT` activity noting the regression.

**Files:**

- Modify: `lib/services/task.service.ts`
- Create: `__tests__/lib/services/task-service-reopen.test.ts`

- [ ] **Step 1: Locate the existing `taskRepository` update helper and activity-creation path**

Grep for `createActivity` or `activityRepository.create` in `task.service.ts` and `task.repository.ts`. Identify the exact call used when updating status.

```bash

```

Use Grep on `lib/services/task.service.ts` and `lib/repositories/activity.repository.ts` for `create` and the `TaskActivityType` arguments used.

- [ ] **Step 2: Write the failing test**

Create `__tests__/lib/services/task-service-reopen.test.ts`:

```typescript
import { taskService } from '@/lib/services/task.service'
import { taskRepository } from '@/lib/repositories/task.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'

jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findForUpdate: jest.fn(),
    updateStatus: jest.fn(), // or whichever real method is used
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))

describe('taskService.reopen', () => {
  beforeEach(() => jest.clearAllMocks())

  it('throws 404 if task not found', async () => {
    ;(taskRepository.findForUpdate as jest.Mock).mockResolvedValue(null)
    await expect(
      taskService.reopen('missing', {
        reason: 'sentry_regression',
        actorId: null,
      })
    ).rejects.toMatchObject({ status: 404 })
  })

  it('sets status to TODO and writes a SENTRY_ALERT activity when reason is sentry_regression', async () => {
    ;(taskRepository.findForUpdate as jest.Mock).mockResolvedValue({
      id: 't1',
      status: 'DONE',
      projectId: 'p1',
    })
    await taskService.reopen('t1', {
      reason: 'sentry_regression',
      actorId: null,
    })
    expect(taskRepository.updateStatus).toHaveBeenCalledWith('t1', 'TODO')
    expect(activityRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 't1',
        type: 'SENTRY_ALERT',
        actorId: null,
      })
    )
  })

  it('is a no-op when task is not in a terminal status', async () => {
    ;(taskRepository.findForUpdate as jest.Mock).mockResolvedValue({
      id: 't1',
      status: 'TODO',
      projectId: 'p1',
    })
    await taskService.reopen('t1', {
      reason: 'sentry_regression',
      actorId: null,
    })
    expect(taskRepository.updateStatus).not.toHaveBeenCalled()
  })
})
```

> **Note:** the exact name `updateStatus` and `activityRepository.create` signature may differ. Before implementing, open `lib/repositories/task.repository.ts` and `lib/repositories/activity.repository.ts` and read the real method signatures, then adjust both the test and the implementation below accordingly.

- [ ] **Step 3: Run to verify failure**

```bash
npm test -- __tests__/lib/services/task-service-reopen.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Add method to `taskService`**

Inside `taskService`, after `updateTask`, add:

```typescript
  /**
   * Move a task back to TODO with a structured activity note.
   * Currently used by Sentry regression handling.
   */
  async reopen(
    taskId: string,
    opts: { reason: 'sentry_regression'; actorId: string | null }
  ) {
    const task = await taskRepository.findForUpdate(taskId)
    if (!task) {
      throw Object.assign(new Error('Task not found'), { status: 404 })
    }
    if (task.status !== 'DONE') return

    // Use whichever status-update helper exists on taskRepository (updateStatus
    // or update, passing { status: 'TODO' }). Match the real signature.
    await taskRepository.updateStatus(taskId, 'TODO')
    await activityRepository.create({
      taskId,
      type: 'SENTRY_ALERT',
      actorId: opts.actorId,
      metadata: { reason: opts.reason, reopened: true },
    })
  },
```

Add imports for `activityRepository` and any needed types at the top of the file.

- [ ] **Step 5: Run to verify pass**

```bash
npm test -- __tests__/lib/services/task-service-reopen.test.ts
```

Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/services/task.service.ts __tests__/lib/services/task-service-reopen.test.ts
git commit -m "feat: add taskService.reopen with SENTRY_ALERT activity [LUM-42]"
```

---

### Task 13: `sentryService` — connect / disconnect / status + tests

**Files:**

- Create: `lib/services/sentry.service.ts`
- Create: `__tests__/lib/services/sentry.service.test.ts`

- [ ] **Step 1: Write the failing test (connect/disconnect/status subset)**

Create `__tests__/lib/services/sentry.service.test.ts`:

```typescript
import { sentryService } from '@/lib/services/sentry.service'
import { sentryRepository } from '@/lib/repositories/sentry.repository'
import { encrypt } from '@/lib/crypto'

jest.mock('@/lib/repositories/sentry.repository', () => ({
  sentryRepository: {
    findIntegrationByWorkspace: jest.fn(),
    upsertIntegration: jest.fn(),
    deleteIntegration: jest.fn(),
  },
}))
jest.mock('@/lib/crypto', () => ({
  encrypt: jest.fn((s: string) => `enc(${s})`),
  decrypt: jest.fn((s: string) => s.replace(/^enc\(|\)$/g, '')),
}))

describe('sentryService status/connect/disconnect', () => {
  beforeEach(() => jest.clearAllMocks())

  describe('getIntegrationStatus', () => {
    it('returns { connected: false } when no integration', async () => {
      ;(
        sentryRepository.findIntegrationByWorkspace as jest.Mock
      ).mockResolvedValue(null)
      const status = await sentryService.getIntegrationStatus('ws1')
      expect(status).toEqual({ connected: false })
    })

    it('returns orgSlug and lastWebhookAt when connected', async () => {
      ;(
        sentryRepository.findIntegrationByWorkspace as jest.Mock
      ).mockResolvedValue({
        id: 'int1',
        orgSlug: 'acme',
        lastWebhookAt: new Date('2026-04-16T10:00:00Z'),
        installedBy: 'mem1',
      })
      const status = await sentryService.getIntegrationStatus('ws1')
      expect(status).toMatchObject({ connected: true, orgSlug: 'acme' })
    })
  })

  describe('connectIntegration', () => {
    it('rejects non-OWNER with 403', async () => {
      await expect(
        sentryService.connectIntegration('ws1', 'mem1', 'MEMBER', {
          orgSlug: 'acme',
          clientSecret: 'plaintext',
        })
      ).rejects.toMatchObject({ status: 403 })
      expect(sentryRepository.upsertIntegration).not.toHaveBeenCalled()
    })

    it('encrypts clientSecret before upserting', async () => {
      ;(sentryRepository.upsertIntegration as jest.Mock).mockResolvedValue({
        id: 'int1',
      })
      await sentryService.connectIntegration('ws1', 'mem1', 'OWNER', {
        orgSlug: 'acme',
        clientSecret: 'plaintext',
      })
      expect(encrypt).toHaveBeenCalledWith('plaintext')
      expect(sentryRepository.upsertIntegration).toHaveBeenCalledWith({
        workspaceId: 'ws1',
        installedBy: 'mem1',
        orgSlug: 'acme',
        clientSecret: 'enc(plaintext)',
      })
    })
  })

  describe('disconnectIntegration', () => {
    it('rejects non-OWNER with 403', async () => {
      await expect(
        sentryService.disconnectIntegration('ws1', 'MEMBER')
      ).rejects.toMatchObject({ status: 403 })
    })

    it('calls deleteIntegration for OWNER', async () => {
      await sentryService.disconnectIntegration('ws1', 'OWNER')
      expect(sentryRepository.deleteIntegration).toHaveBeenCalledWith('ws1')
    })
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- __tests__/lib/services/sentry.service.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `lib/services/sentry.service.ts` with the three methods**

```typescript
import { encrypt, decrypt } from '@/lib/crypto'
import { sentryRepository } from '@/lib/repositories/sentry.repository'

export const sentryService = {
  async getIntegrationStatus(workspaceId: string) {
    const integration =
      await sentryRepository.findIntegrationByWorkspace(workspaceId)
    if (!integration) return { connected: false } as const
    return {
      connected: true,
      orgSlug: integration.orgSlug,
      lastWebhookAt: integration.lastWebhookAt,
      installedBy: integration.installedBy,
    } as const
  },

  async connectIntegration(
    workspaceId: string,
    memberId: string,
    role: string,
    data: { orgSlug: string; clientSecret: string }
  ) {
    if (role !== 'OWNER') {
      throw Object.assign(
        new Error('Only workspace owners can connect Sentry'),
        { status: 403 }
      )
    }
    return sentryRepository.upsertIntegration({
      workspaceId,
      installedBy: memberId,
      orgSlug: data.orgSlug,
      clientSecret: encrypt(data.clientSecret),
    })
  },

  async disconnectIntegration(workspaceId: string, role: string) {
    if (role !== 'OWNER') {
      throw Object.assign(
        new Error('Only workspace owners can disconnect Sentry'),
        { status: 403 }
      )
    }
    return sentryRepository.deleteIntegration(workspaceId)
  },
}

// Unused in this task, kept to silence ts-unused-imports (will be used in later tasks):
void decrypt
```

- [ ] **Step 4: Run to verify pass**

```bash
npm test -- __tests__/lib/services/sentry.service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/services/sentry.service.ts __tests__/lib/services/sentry.service.test.ts
git commit -m "feat: add sentryService connect/disconnect/status [LUM-42]"
```

---

### Task 14: `sentryService` — mappings CRUD + tests

**Files:**

- Modify: `lib/services/sentry.service.ts`
- Modify: `__tests__/lib/services/sentry.service.test.ts`

- [ ] **Step 1: Append failing tests**

Add to `__tests__/lib/services/sentry.service.test.ts`:

```typescript
describe('sentryService mappings CRUD', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Add the new methods to the mocked repo:
    Object.assign(sentryRepository as object, {
      findIntegrationByWorkspace: jest.fn().mockResolvedValue({ id: 'int1' }),
      listMappings: jest.fn().mockResolvedValue([]),
      findProjectInWorkspace: jest.fn().mockResolvedValue({ id: 'p1' }),
      findMappingByProjectSlug: jest.fn().mockResolvedValue(null),
      createMapping: jest
        .fn()
        .mockResolvedValue({
          id: 'map1',
          sentryProjectSlug: 'frontend',
          projectId: 'p1',
        }),
      findMappingWithIntegration: jest.fn(),
      deleteMapping: jest.fn(),
    })
  })

  it('listMappings throws 404 when integration missing', async () => {
    ;(
      sentryRepository.findIntegrationByWorkspace as jest.Mock
    ).mockResolvedValue(null)
    await expect(sentryService.listMappings('ws1')).rejects.toMatchObject({
      status: 404,
    })
  })

  it('listMappings returns repository result', async () => {
    ;(sentryRepository.listMappings as jest.Mock).mockResolvedValue([
      { id: 'm1' },
    ])
    const result = await sentryService.listMappings('ws1')
    expect(result).toEqual([{ id: 'm1' }])
  })

  it('createMapping rejects non-OWNER with 403', async () => {
    await expect(
      sentryService.createMapping('ws1', 'MEMBER', {
        sentryProjectSlug: 'frontend',
        projectId: 'p1',
      })
    ).rejects.toMatchObject({ status: 403 })
  })

  it('createMapping rejects when project not in workspace', async () => {
    ;(sentryRepository.findProjectInWorkspace as jest.Mock).mockResolvedValue(
      null
    )
    await expect(
      sentryService.createMapping('ws1', 'OWNER', {
        sentryProjectSlug: 'frontend',
        projectId: 'bad',
      })
    ).rejects.toMatchObject({ status: 400 })
  })

  it('createMapping rejects duplicates with 409', async () => {
    ;(sentryRepository.findMappingByProjectSlug as jest.Mock).mockResolvedValue(
      { id: 'existing' }
    )
    await expect(
      sentryService.createMapping('ws1', 'OWNER', {
        sentryProjectSlug: 'frontend',
        projectId: 'p1',
      })
    ).rejects.toMatchObject({ status: 409 })
  })

  it('createMapping happy path creates mapping', async () => {
    const r = await sentryService.createMapping('ws1', 'OWNER', {
      sentryProjectSlug: 'frontend',
      projectId: 'p1',
    })
    expect(r.id).toBe('map1')
  })

  it('deleteMapping validates ownership', async () => {
    ;(
      sentryRepository.findMappingWithIntegration as jest.Mock
    ).mockResolvedValue({
      id: 'map1',
      integration: { workspaceId: 'other-ws' },
    })
    await expect(
      sentryService.deleteMapping('ws1', 'OWNER', 'map1')
    ).rejects.toMatchObject({ status: 404 })
  })

  it('deleteMapping rejects non-OWNER', async () => {
    ;(
      sentryRepository.findMappingWithIntegration as jest.Mock
    ).mockResolvedValue({
      id: 'map1',
      integration: { workspaceId: 'ws1' },
    })
    await expect(
      sentryService.deleteMapping('ws1', 'MEMBER', 'map1')
    ).rejects.toMatchObject({ status: 403 })
  })

  it('deleteMapping happy path deletes', async () => {
    ;(
      sentryRepository.findMappingWithIntegration as jest.Mock
    ).mockResolvedValue({
      id: 'map1',
      integration: { workspaceId: 'ws1' },
    })
    await sentryService.deleteMapping('ws1', 'OWNER', 'map1')
    expect(sentryRepository.deleteMapping).toHaveBeenCalledWith('map1')
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- __tests__/lib/services/sentry.service.test.ts
```

Expected: FAIL — mapping methods missing.

- [ ] **Step 3: Add methods to `sentryService`**

Append to `sentryService` object in `lib/services/sentry.service.ts`:

```typescript
  async listMappings(workspaceId: string) {
    const integration = await sentryRepository.findIntegrationByWorkspace(workspaceId)
    if (!integration) {
      throw Object.assign(new Error('Sentry not connected'), { status: 404 })
    }
    return sentryRepository.listMappings(integration.id)
  },

  async createMapping(
    workspaceId: string,
    role: string,
    data: { sentryProjectSlug: string; projectId: string }
  ) {
    if (role !== 'OWNER') {
      throw Object.assign(
        new Error('Only workspace owners can manage Sentry mappings'),
        { status: 403 }
      )
    }
    const integration = await sentryRepository.findIntegrationByWorkspace(workspaceId)
    if (!integration) {
      throw Object.assign(new Error('Sentry not connected'), { status: 404 })
    }
    const project = await sentryRepository.findProjectInWorkspace(
      data.projectId,
      workspaceId
    )
    if (!project) {
      throw Object.assign(
        new Error('Project is not part of this workspace'),
        { status: 400 }
      )
    }
    const existing = await sentryRepository.findMappingByProjectSlug(
      integration.id,
      data.sentryProjectSlug
    )
    if (existing) {
      throw Object.assign(
        new Error('This Sentry project is already mapped'),
        { status: 409 }
      )
    }
    return sentryRepository.createMapping({
      integrationId: integration.id,
      sentryProjectSlug: data.sentryProjectSlug,
      projectId: data.projectId,
    })
  },

  async deleteMapping(workspaceId: string, role: string, mappingId: string) {
    if (role !== 'OWNER') {
      throw Object.assign(
        new Error('Only workspace owners can manage Sentry mappings'),
        { status: 403 }
      )
    }
    const mapping = await sentryRepository.findMappingWithIntegration(mappingId)
    if (!mapping || mapping.integration.workspaceId !== workspaceId) {
      throw Object.assign(new Error('Not found'), { status: 404 })
    }
    return sentryRepository.deleteMapping(mappingId)
  },
```

- [ ] **Step 4: Run to verify pass**

```bash
npm test -- __tests__/lib/services/sentry.service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/services/sentry.service.ts __tests__/lib/services/sentry.service.test.ts
git commit -m "feat: add sentryService mappings CRUD [LUM-42]"
```

---

### Task 15: `_ensureBugTag` + `_resolveAssignee` helpers + tests

**Files:**

- Modify: `lib/services/sentry.service.ts`
- Modify: `__tests__/lib/services/sentry.service.test.ts`

- [ ] **Step 1: Append failing tests**

Add to `__tests__/lib/services/sentry.service.test.ts`:

```typescript
import { tagRepository } from '@/lib/repositories/tag.repository'
import { memberRepository } from '@/lib/repositories/member.repository'

jest.mock('@/lib/repositories/tag.repository', () => ({
  tagRepository: { findByName: jest.fn(), create: jest.fn() },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: { findActorsByEmailInWorkspace: jest.fn() },
}))

describe('sentryService._ensureBugTag', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns existing bug tag id', async () => {
    ;(tagRepository.findByName as jest.Mock).mockResolvedValue({ id: 'tag1' })
    // @ts-expect-error private method intentionally exercised
    const id = await sentryService._ensureBugTag('ws1')
    expect(id).toBe('tag1')
    expect(tagRepository.create).not.toHaveBeenCalled()
  })

  it('creates bug tag with red colour when missing', async () => {
    ;(tagRepository.findByName as jest.Mock).mockResolvedValue(null)
    ;(tagRepository.create as jest.Mock).mockResolvedValue({ id: 'tag2' })
    // @ts-expect-error private
    const id = await sentryService._ensureBugTag('ws1')
    expect(id).toBe('tag2')
    expect(tagRepository.create).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      name: 'bug',
      color: '#ef4444',
    })
  })

  it('recovers from race (P2002) by re-finding', async () => {
    ;(tagRepository.findByName as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'tag3' })
    ;(tagRepository.create as jest.Mock).mockRejectedValue(
      Object.assign(new Error('unique'), { code: 'P2002' })
    )
    // @ts-expect-error private
    const id = await sentryService._ensureBugTag('ws1')
    expect(id).toBe('tag3')
  })
})

describe('sentryService._resolveAssignee', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns first matched actor id', async () => {
    ;(
      memberRepository.findActorsByEmailInWorkspace as jest.Mock
    ).mockResolvedValue(['actor-ada', 'actor-bob'])
    // @ts-expect-error private
    const id = await sentryService._resolveAssignee('ws1', [
      'ada@example.com',
      'bob@example.com',
    ])
    expect(id).toBe('actor-ada')
  })

  it('returns null when no emails match', async () => {
    ;(
      memberRepository.findActorsByEmailInWorkspace as jest.Mock
    ).mockResolvedValue([])
    // @ts-expect-error private
    const id = await sentryService._resolveAssignee('ws1', ['x@example.com'])
    expect(id).toBeNull()
  })

  it('returns null when emails list is empty', async () => {
    // @ts-expect-error private
    const id = await sentryService._resolveAssignee('ws1', [])
    expect(id).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- __tests__/lib/services/sentry.service.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Add helpers to `sentryService`**

Add imports at the top of `lib/services/sentry.service.ts`:

```typescript
import { tagRepository } from '@/lib/repositories/tag.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
```

Append to `sentryService`:

```typescript
  async _ensureBugTag(workspaceId: string): Promise<string> {
    const existing = await tagRepository.findByName(workspaceId, 'bug')
    if (existing) return existing.id
    try {
      const created = await tagRepository.create({
        workspaceId,
        name: 'bug',
        color: '#ef4444',
      })
      return created.id
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        const raced = await tagRepository.findByName(workspaceId, 'bug')
        if (raced) return raced.id
      }
      throw err
    }
  },

  async _resolveAssignee(
    workspaceId: string,
    emails: string[]
  ): Promise<string | null> {
    if (emails.length === 0) return null
    const actorIds = await memberRepository.findActorsByEmailInWorkspace(
      workspaceId,
      emails
    )
    return actorIds[0] ?? null
  },
```

- [ ] **Step 4: Run to verify pass**

```bash
npm test -- __tests__/lib/services/sentry.service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/services/sentry.service.ts __tests__/lib/services/sentry.service.test.ts
git commit -m "feat: add Sentry tag + assignee helpers [LUM-42]"
```

---

### Task 16: `sentryService.handleWebhook` + `_createTaskFromIssue` + `_handleRepeatedAlert` + tests

This is the big one — the webhook orchestration.

**Files:**

- Modify: `lib/services/sentry.service.ts`
- Modify: `__tests__/lib/services/sentry.service.test.ts`

- [ ] **Step 1: Append failing tests**

Add to `__tests__/lib/services/sentry.service.test.ts`:

```typescript
import { activityRepository } from '@/lib/repositories/activity.repository'
import { taskService } from '@/lib/services/task.service'
import { taskRepository } from '@/lib/repositories/task.repository'
import alertFixture from '@/__tests__/fixtures/sentry-issue-alert.json'
import { createHmac } from 'crypto'

jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))
jest.mock('@/lib/services/task.service', () => ({
  taskService: {
    createFromAutomation: jest.fn(),
    reopen: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findById: jest.fn() },
}))

function signed(body: string, secret: string) {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex')
}

const PLAIN_SECRET = 'test-secret'
const ENC_SECRET = `enc(${PLAIN_SECRET})`

describe('sentryService.handleWebhook', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    Object.assign(sentryRepository as object, {
      findIntegrationByOrgSlug: jest.fn().mockResolvedValue({
        id: 'int1',
        workspaceId: 'ws1',
        clientSecret: ENC_SECRET,
      }),
      findMappingByProjectSlug: jest.fn().mockResolvedValue({
        id: 'map1',
        projectId: 'p1',
        integrationId: 'int1',
      }),
      findLink: jest.fn().mockResolvedValue(null),
      createLink: jest.fn().mockResolvedValue({ id: 'link1', taskId: 't1' }),
      markWebhookReceived: jest.fn(),
    })
    // ensureBugTag + resolveAssignee behaviour
    ;(tagRepository.findByName as jest.Mock).mockResolvedValue({ id: 'tagBug' })
    ;(
      memberRepository.findActorsByEmailInWorkspace as jest.Mock
    ).mockResolvedValue([])
    ;(taskService.createFromAutomation as jest.Mock).mockResolvedValue({
      task: { id: 't1' },
    })
  })

  it('throws 401 when signature is missing', async () => {
    const body = JSON.stringify(alertFixture)
    await expect(
      sentryService.handleWebhook({ rawBody: body, signature: null })
    ).rejects.toMatchObject({ status: 401 })
  })

  it('throws 404 when orgSlug unmatched', async () => {
    ;(sentryRepository.findIntegrationByOrgSlug as jest.Mock).mockResolvedValue(
      null
    )
    // Fixture orgSlug is parsed from web_url host ("acme-inc.sentry.io")
    const body = JSON.stringify(alertFixture)
    await expect(
      sentryService.handleWebhook({ rawBody: body, signature: 'deadbeef' })
    ).rejects.toMatchObject({ status: 404 })
  })

  it('throws 401 when signature is wrong', async () => {
    const body = JSON.stringify(alertFixture)
    await expect(
      sentryService.handleWebhook({ rawBody: body, signature: 'deadbeef' })
    ).rejects.toMatchObject({ status: 401 })
  })

  it('skips silently when mapping is missing', async () => {
    ;(sentryRepository.findMappingByProjectSlug as jest.Mock).mockResolvedValue(
      null
    )
    const body = JSON.stringify(alertFixture)
    const sig = signed(body, PLAIN_SECRET)
    const result = await sentryService.handleWebhook({
      rawBody: body,
      signature: sig,
    })
    expect(result).toMatchObject({ skipped: 'no_mapping' })
    expect(taskService.createFromAutomation).not.toHaveBeenCalled()
  })

  it('creates task + link for first-time issue', async () => {
    const body = JSON.stringify(alertFixture)
    const sig = signed(body, PLAIN_SECRET)
    const result = await sentryService.handleWebhook({
      rawBody: body,
      signature: sig,
    })
    expect(taskService.createFromAutomation).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({
        priority: 'HIGH',
        tagIds: ['tagBug'],
      })
    )
    expect(sentryRepository.createLink).toHaveBeenCalledWith({
      integrationId: 'int1',
      sentryIssueId: '4555555555',
      taskId: 't1',
    })
    expect(sentryRepository.markWebhookReceived).toHaveBeenCalledWith('int1')
    expect(result).toMatchObject({ created: true, taskId: 't1' })
  })

  it('records activity and does NOT create task for repeated issue', async () => {
    ;(sentryRepository.findLink as jest.Mock).mockResolvedValue({
      id: 'link1',
      taskId: 't1',
    })
    ;(taskRepository.findById as jest.Mock).mockResolvedValue({
      id: 't1',
      status: 'TODO',
    })
    const body = JSON.stringify(alertFixture)
    const sig = signed(body, PLAIN_SECRET)
    const result = await sentryService.handleWebhook({
      rawBody: body,
      signature: sig,
    })
    expect(taskService.createFromAutomation).not.toHaveBeenCalled()
    expect(activityRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 't1', type: 'SENTRY_ALERT' })
    )
    expect(result).toMatchObject({ repeated: true, taskId: 't1' })
  })

  it('reopens DONE task on regression', async () => {
    ;(sentryRepository.findLink as jest.Mock).mockResolvedValue({
      id: 'link1',
      taskId: 't1',
    })
    ;(taskRepository.findById as jest.Mock).mockResolvedValue({
      id: 't1',
      status: 'DONE',
    })
    const body = JSON.stringify(alertFixture)
    const sig = signed(body, PLAIN_SECRET)
    await sentryService.handleWebhook({ rawBody: body, signature: sig })
    expect(taskService.reopen).toHaveBeenCalledWith('t1', {
      reason: 'sentry_regression',
      actorId: null,
    })
  })

  it('falls back to repeated flow on link P2002 race', async () => {
    ;(sentryRepository.findLink as jest.Mock)
      .mockResolvedValueOnce(null) // first read: not yet present
      .mockResolvedValueOnce({ id: 'link1', taskId: 't1' }) // after race: present
    ;(sentryRepository.createLink as jest.Mock).mockRejectedValue(
      Object.assign(new Error('duplicate'), { code: 'P2002' })
    )
    ;(taskRepository.findById as jest.Mock).mockResolvedValue({
      id: 't1',
      status: 'TODO',
    })
    const body = JSON.stringify(alertFixture)
    const sig = signed(body, PLAIN_SECRET)
    const result = await sentryService.handleWebhook({
      rawBody: body,
      signature: sig,
    })
    expect(activityRepository.create).toHaveBeenCalled()
    expect(result).toMatchObject({ repeated: true })
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- __tests__/lib/services/sentry.service.test.ts
```

Expected: FAIL — handleWebhook not implemented.

- [ ] **Step 3: Add `handleWebhook` + private helpers**

Add imports to `lib/services/sentry.service.ts`:

```typescript
import {
  verifySentrySignature,
  extractIssueFields,
  mapLevelToPriority,
  pickSuggestedOwnerEmails,
  buildTaskDescription,
  type SentryIssueAlertPayload,
} from '@/lib/integrations/sentry'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { taskService } from '@/lib/services/task.service'
import { taskRepository } from '@/lib/repositories/task.repository'
```

The org slug is not a dedicated field in the Sentry webhook payload; it's present in `data.event.web_url` (e.g. `https://acme-inc.sentry.io/issues/123/`). Add a small helper:

```typescript
function extractOrgSlugFromWebUrl(webUrl: string | undefined): string | null {
  if (!webUrl) return null
  try {
    const host = new URL(webUrl).host // e.g. "acme-inc.sentry.io"
    const first = host.split('.')[0]
    return first && first !== 'sentry' ? first : null
  } catch {
    return null
  }
}
```

Add the main method to the `sentryService` object:

```typescript
  async handleWebhook(input: {
    rawBody: string
    signature: string | null
  }): Promise<
    | { created: true; taskId: string }
    | { repeated: true; taskId: string }
    | { skipped: 'no_mapping' | 'missing_issue_id' }
  > {
    if (!input.signature) {
      throw Object.assign(new Error('Missing signature'), { status: 401 })
    }

    let payload: SentryIssueAlertPayload
    try {
      payload = JSON.parse(input.rawBody) as SentryIssueAlertPayload
    } catch {
      throw Object.assign(new Error('Invalid JSON'), { status: 400 })
    }

    const orgSlug = extractOrgSlugFromWebUrl(payload.data?.event?.web_url)
    if (!orgSlug) {
      throw Object.assign(new Error('Cannot determine org slug'), { status: 400 })
    }

    const integration = await sentryRepository.findIntegrationByOrgSlug(orgSlug)
    if (!integration) {
      throw Object.assign(new Error('Unknown org'), { status: 404 })
    }

    const secret = decrypt(integration.clientSecret)
    if (!verifySentrySignature(input.rawBody, input.signature, secret)) {
      throw Object.assign(new Error('Invalid signature'), { status: 401 })
    }

    // From here, log-and-return-200 is the policy (service returns structured,
    // route catches and returns 200 for downstream errors).

    let fields: ReturnType<typeof extractIssueFields>
    try {
      fields = extractIssueFields(payload)
    } catch (err) {
      console.error('[sentry/webhook] payload parse error:', err)
      return { skipped: 'missing_issue_id' }
    }

    const mapping = await sentryRepository.findMappingByProjectSlug(
      integration.id,
      fields.sentryProjectSlug
    )
    if (!mapping) {
      await sentryRepository.markWebhookReceived(integration.id).catch(() => {})
      return { skipped: 'no_mapping' }
    }

    // Dedup: do we already have a task for this Sentry issue?
    const existing = await sentryRepository.findLink(
      integration.id,
      fields.sentryIssueId
    )

    if (existing) {
      await this._handleRepeatedAlert(existing.taskId, fields)
      await sentryRepository.markWebhookReceived(integration.id).catch(() => {})
      return { repeated: true, taskId: existing.taskId }
    }

    // First time: create task + link atomically-ish.
    try {
      const taskId = await this._createTaskFromIssue(
        integration.workspaceId,
        mapping.projectId,
        fields,
        payload
      )
      await sentryRepository.createLink({
        integrationId: integration.id,
        sentryIssueId: fields.sentryIssueId,
        taskId,
      })
      await sentryRepository.markWebhookReceived(integration.id).catch(() => {})
      return { created: true, taskId }
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        // Concurrent webhook beat us to it. Re-read and treat as repeated.
        const now = await sentryRepository.findLink(
          integration.id,
          fields.sentryIssueId
        )
        if (now) {
          await this._handleRepeatedAlert(now.taskId, fields)
          await sentryRepository.markWebhookReceived(integration.id).catch(() => {})
          return { repeated: true, taskId: now.taskId }
        }
      }
      throw err
    }
  },

  async _createTaskFromIssue(
    workspaceId: string,
    projectId: string,
    fields: ReturnType<typeof extractIssueFields>,
    payload: SentryIssueAlertPayload
  ): Promise<string> {
    const bugTagId = await this._ensureBugTag(workspaceId)
    const assigneeActorId = await this._resolveAssignee(
      workspaceId,
      pickSuggestedOwnerEmails(payload)
    )

    const { task } = await taskService.createFromAutomation(projectId, {
      title: fields.title,
      description: buildTaskDescription(fields),
      priority: mapLevelToPriority(fields.level),
      assigneeActorId,
      tagIds: [bugTagId],
    })

    return task.id
  },

  async _handleRepeatedAlert(
    taskId: string,
    fields: ReturnType<typeof extractIssueFields>
  ): Promise<void> {
    const task = await taskRepository.findById(taskId)
    if (!task) return

    await activityRepository.create({
      taskId,
      type: 'SENTRY_ALERT',
      actorId: null,
      metadata: {
        triggeredRule: fields.triggeredRule,
        eventCount: fields.eventCount,
        lastSeen: fields.lastSeen,
        webUrl: fields.webUrl,
        level: fields.level,
      },
    })

    if (task.status === 'DONE') {
      await taskService.reopen(taskId, {
        reason: 'sentry_regression',
        actorId: null,
      })
    }
  },
```

> **Note:** `activityRepository.create`'s exact signature may differ — check `lib/repositories/activity.repository.ts` and adjust both the implementation and the test to match. The shape `{ taskId, type, actorId, metadata }` is the intent.

- [ ] **Step 4: Run to verify pass**

```bash
npm test -- __tests__/lib/services/sentry.service.test.ts
```

Expected: PASS (all existing + 8 new tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/services/sentry.service.ts __tests__/lib/services/sentry.service.test.ts
git commit -m "feat: add Sentry webhook handler with dedup + regression [LUM-42]"
```

---

### Task 17: Zod validation schemas

**Files:**

- Create: `lib/validation/sentry.schema.ts`

- [ ] **Step 1: Look at existing Zod schema files for style reference**

```bash

```

Read `lib/validation/` directory (use Glob on `lib/validation/*.ts`) to find an existing short schema to match style. Note the import convention.

- [ ] **Step 2: Create `lib/validation/sentry.schema.ts`**

```typescript
import { z } from 'zod'

const ORG_SLUG = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/

export const connectSentrySchema = z.object({
  orgSlug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(ORG_SLUG, 'Invalid Sentry organization slug'),
  clientSecret: z.string().min(10).max(256),
})

export type ConnectSentryInput = z.infer<typeof connectSentrySchema>

export const createMappingSchema = z.object({
  sentryProjectSlug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(ORG_SLUG, 'Invalid Sentry project slug'),
  projectId: z.string().min(1),
})

export type CreateMappingInput = z.infer<typeof createMappingSchema>
```

- [ ] **Step 3: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/validation/sentry.schema.ts
git commit -m "feat: add Sentry Zod schemas [LUM-42]"
```

---

### Task 18: `/api/sentry/integration` route + tests

**Files:**

- Create: `app/api/sentry/integration/route.ts`
- Create: `__tests__/api/sentry/integration-route.test.ts`

- [ ] **Step 1: Inspect existing slack integration route for the shared auth helpers**

Read `app/api/slack/integration/route.ts` (already done during planning) and `lib/api/helpers.ts` / `lib/auth.ts` to confirm `requireAuth`, `requireWorkspaceByUrl`, `requireWorkspaceMember` signatures.

- [ ] **Step 2: Write the failing test**

Create `__tests__/api/sentry/integration-route.test.ts`:

```typescript
import { NextRequest } from 'next/server'
import { GET, POST, DELETE } from '@/app/api/sentry/integration/route'
import { sentryService } from '@/lib/services/sentry.service'

jest.mock('@/lib/auth', () => ({
  requireAuth: jest.fn(async () => ({ userId: 'user1' })),
  requireWorkspaceMember: jest.fn(async () => ({
    memberId: 'mem1',
    role: 'OWNER',
  })),
}))
jest.mock('@/lib/api/helpers', () => ({
  requireWorkspaceByUrl: jest.fn(async () => ({ workspaceId: 'ws1' })),
}))
jest.mock('@/lib/services/sentry.service', () => ({
  sentryService: {
    getIntegrationStatus: jest.fn(),
    connectIntegration: jest.fn(),
    disconnectIntegration: jest.fn(),
  },
}))

function req(url: string, body?: unknown, method = 'GET') {
  return new NextRequest(url, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: { 'content-type': 'application/json' },
  })
}

describe('GET /api/sentry/integration', () => {
  it('returns status from service', async () => {
    ;(sentryService.getIntegrationStatus as jest.Mock).mockResolvedValue({
      connected: true,
      orgSlug: 'acme',
    })
    const res = await GET(
      req('http://x/api/sentry/integration?workspaceUrl=acme')
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ connected: true, orgSlug: 'acme' })
  })
})

describe('POST /api/sentry/integration', () => {
  it('rejects invalid payload with 400', async () => {
    const res = await POST(
      req(
        'http://x/api/sentry/integration?workspaceUrl=acme',
        { orgSlug: 'INVALID_UPPER', clientSecret: 'short' },
        'POST'
      )
    )
    expect(res.status).toBe(400)
  })

  it('calls connectIntegration on valid payload', async () => {
    ;(sentryService.connectIntegration as jest.Mock).mockResolvedValue({
      id: 'int1',
    })
    const res = await POST(
      req(
        'http://x/api/sentry/integration?workspaceUrl=acme',
        { orgSlug: 'acme-inc', clientSecret: 'secret-value-long' },
        'POST'
      )
    )
    expect(res.status).toBe(200)
    expect(sentryService.connectIntegration).toHaveBeenCalled()
  })

  it('returns 403 when service throws 403', async () => {
    ;(sentryService.connectIntegration as jest.Mock).mockRejectedValue(
      Object.assign(new Error('owner only'), { status: 403 })
    )
    const res = await POST(
      req(
        'http://x/api/sentry/integration?workspaceUrl=acme',
        { orgSlug: 'acme', clientSecret: 'secret-value-long' },
        'POST'
      )
    )
    expect(res.status).toBe(403)
  })
})

describe('DELETE /api/sentry/integration', () => {
  it('calls disconnect and returns 200', async () => {
    const res = await DELETE(
      req(
        'http://x/api/sentry/integration?workspaceUrl=acme',
        undefined,
        'DELETE'
      )
    )
    expect(res.status).toBe(200)
    expect(sentryService.disconnectIntegration).toHaveBeenCalledWith(
      'ws1',
      'OWNER'
    )
  })
})
```

- [ ] **Step 3: Run to verify failure**

```bash
npm test -- __tests__/api/sentry/integration-route.test.ts
```

Expected: FAIL — route not implemented.

- [ ] **Step 4: Create `app/api/sentry/integration/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { requireWorkspaceByUrl } from '@/lib/api/helpers'
import { sentryService } from '@/lib/services/sentry.service'
import { connectSentrySchema } from '@/lib/validation/sentry.schema'

function errorStatus(err: unknown): number {
  return (err as { status?: number }).status ?? 500
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await requireWorkspaceByUrl(
      userId,
      request.nextUrl.searchParams.get('workspaceUrl')
    )
    if (ws instanceof NextResponse) return ws

    const status = await sentryService.getIntegrationStatus(ws.workspaceId)
    return NextResponse.json(status)
  } catch (error) {
    console.error('[sentry/integration] GET error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await requireWorkspaceByUrl(
      userId,
      request.nextUrl.searchParams.get('workspaceUrl')
    )
    if (ws instanceof NextResponse) return ws

    const memberResult = await requireWorkspaceMember(ws.workspaceId, userId)
    if (memberResult instanceof NextResponse) return memberResult

    const json = await request.json()
    const parsed = connectSentrySchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', issues: parsed.error.issues },
        { status: 400 }
      )
    }

    const result = await sentryService.connectIntegration(
      ws.workspaceId,
      memberResult.memberId,
      memberResult.role,
      parsed.data
    )
    return NextResponse.json({ success: true, id: result.id })
  } catch (error) {
    const status = errorStatus(error)
    if (status === 403 || status === 404 || status === 409) {
      return NextResponse.json({ error: (error as Error).message }, { status })
    }
    console.error('[sentry/integration] POST error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await requireWorkspaceByUrl(
      userId,
      request.nextUrl.searchParams.get('workspaceUrl')
    )
    if (ws instanceof NextResponse) return ws

    const memberResult = await requireWorkspaceMember(ws.workspaceId, userId)
    if (memberResult instanceof NextResponse) return memberResult

    await sentryService.disconnectIntegration(ws.workspaceId, memberResult.role)
    return NextResponse.json({ success: true })
  } catch (error) {
    const status = errorStatus(error)
    if (status === 403 || status === 404) {
      return NextResponse.json({ error: (error as Error).message }, { status })
    }
    console.error('[sentry/integration] DELETE error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 5: Run to verify pass**

```bash
npm test -- __tests__/api/sentry/integration-route.test.ts
```

Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
npx tsc --noEmit
git add app/api/sentry/integration/route.ts __tests__/api/sentry/integration-route.test.ts
git commit -m "feat: add /api/sentry/integration route [LUM-42]"
```

---

### Task 19: `/api/sentry/mappings` routes + tests

**Files:**

- Create: `app/api/sentry/mappings/route.ts`
- Create: `app/api/sentry/mappings/[id]/route.ts`
- Create: `__tests__/api/sentry/mappings-route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/sentry/mappings-route.test.ts` (mirror the integration-route test structure; cover GET/POST on base route and DELETE on [id] route; test permission errors; test Zod validation rejection).

```typescript
import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/sentry/mappings/route'
import { DELETE } from '@/app/api/sentry/mappings/[id]/route'
import { sentryService } from '@/lib/services/sentry.service'

jest.mock('@/lib/auth', () => ({
  requireAuth: jest.fn(async () => ({ userId: 'user1' })),
  requireWorkspaceMember: jest.fn(async () => ({
    memberId: 'mem1',
    role: 'OWNER',
  })),
}))
jest.mock('@/lib/api/helpers', () => ({
  requireWorkspaceByUrl: jest.fn(async () => ({ workspaceId: 'ws1' })),
}))
jest.mock('@/lib/services/sentry.service', () => ({
  sentryService: {
    listMappings: jest.fn(),
    createMapping: jest.fn(),
    deleteMapping: jest.fn(),
  },
}))

function req(url: string, body?: unknown, method = 'GET') {
  return new NextRequest(url, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: { 'content-type': 'application/json' },
  })
}

describe('GET /api/sentry/mappings', () => {
  it('returns mappings', async () => {
    ;(sentryService.listMappings as jest.Mock).mockResolvedValue([{ id: 'm1' }])
    const res = await GET(req('http://x/api/sentry/mappings?workspaceUrl=acme'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ id: 'm1' }])
  })
})

describe('POST /api/sentry/mappings', () => {
  it('rejects bad input with 400', async () => {
    const res = await POST(
      req(
        'http://x/api/sentry/mappings?workspaceUrl=acme',
        { sentryProjectSlug: '', projectId: '' },
        'POST'
      )
    )
    expect(res.status).toBe(400)
  })

  it('creates mapping with 200', async () => {
    ;(sentryService.createMapping as jest.Mock).mockResolvedValue({
      id: 'map1',
      sentryProjectSlug: 'frontend',
      projectId: 'p1',
    })
    const res = await POST(
      req(
        'http://x/api/sentry/mappings?workspaceUrl=acme',
        { sentryProjectSlug: 'frontend', projectId: 'p1' },
        'POST'
      )
    )
    expect(res.status).toBe(200)
  })

  it('returns 409 on duplicate', async () => {
    ;(sentryService.createMapping as jest.Mock).mockRejectedValue(
      Object.assign(new Error('dup'), { status: 409 })
    )
    const res = await POST(
      req(
        'http://x/api/sentry/mappings?workspaceUrl=acme',
        { sentryProjectSlug: 'frontend', projectId: 'p1' },
        'POST'
      )
    )
    expect(res.status).toBe(409)
  })
})

describe('DELETE /api/sentry/mappings/[id]', () => {
  it('calls deleteMapping and returns 200', async () => {
    const res = await DELETE(
      req(
        'http://x/api/sentry/mappings/m1?workspaceUrl=acme',
        undefined,
        'DELETE'
      ),
      { params: Promise.resolve({ id: 'm1' }) }
    )
    expect(res.status).toBe(200)
    expect(sentryService.deleteMapping).toHaveBeenCalledWith(
      'ws1',
      'OWNER',
      'm1'
    )
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- __tests__/api/sentry/mappings-route.test.ts
```

Expected: FAIL — routes not implemented.

- [ ] **Step 3: Create `app/api/sentry/mappings/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { requireWorkspaceByUrl } from '@/lib/api/helpers'
import { sentryService } from '@/lib/services/sentry.service'
import { createMappingSchema } from '@/lib/validation/sentry.schema'

function errorStatus(err: unknown): number {
  return (err as { status?: number }).status ?? 500
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await requireWorkspaceByUrl(
      userId,
      request.nextUrl.searchParams.get('workspaceUrl')
    )
    if (ws instanceof NextResponse) return ws

    const mappings = await sentryService.listMappings(ws.workspaceId)
    return NextResponse.json(mappings)
  } catch (error) {
    const status = errorStatus(error)
    if (status === 404) {
      return NextResponse.json({ error: 'Not connected' }, { status: 404 })
    }
    console.error('[sentry/mappings] GET error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await requireWorkspaceByUrl(
      userId,
      request.nextUrl.searchParams.get('workspaceUrl')
    )
    if (ws instanceof NextResponse) return ws

    const memberResult = await requireWorkspaceMember(ws.workspaceId, userId)
    if (memberResult instanceof NextResponse) return memberResult

    const parsed = createMappingSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', issues: parsed.error.issues },
        { status: 400 }
      )
    }

    const result = await sentryService.createMapping(
      ws.workspaceId,
      memberResult.role,
      parsed.data
    )
    return NextResponse.json(result)
  } catch (error) {
    const status = errorStatus(error)
    if ([400, 403, 404, 409].includes(status)) {
      return NextResponse.json({ error: (error as Error).message }, { status })
    }
    console.error('[sentry/mappings] POST error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 4: Create `app/api/sentry/mappings/[id]/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { requireWorkspaceByUrl } from '@/lib/api/helpers'
import { sentryService } from '@/lib/services/sentry.service'

function errorStatus(err: unknown): number {
  return (err as { status?: number }).status ?? 500
}

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params

    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await requireWorkspaceByUrl(
      userId,
      request.nextUrl.searchParams.get('workspaceUrl')
    )
    if (ws instanceof NextResponse) return ws

    const memberResult = await requireWorkspaceMember(ws.workspaceId, userId)
    if (memberResult instanceof NextResponse) return memberResult

    await sentryService.deleteMapping(ws.workspaceId, memberResult.role, id)
    return NextResponse.json({ success: true })
  } catch (error) {
    const status = errorStatus(error)
    if ([403, 404].includes(status)) {
      return NextResponse.json({ error: (error as Error).message }, { status })
    }
    console.error('[sentry/mappings] DELETE error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 5: Run to verify pass**

```bash
npm test -- __tests__/api/sentry/mappings-route.test.ts
```

Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
npx tsc --noEmit
git add app/api/sentry/mappings app/api/sentry/mappings/\[id\] __tests__/api/sentry/mappings-route.test.ts
git commit -m "feat: add /api/sentry/mappings routes [LUM-42]"
```

---

### Task 20: `/api/webhooks/sentry` route + tests

**Files:**

- Create: `app/api/webhooks/sentry/route.ts`
- Create: `__tests__/api/webhooks/sentry-route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/webhooks/sentry-route.test.ts`:

```typescript
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/webhooks/sentry/route'
import { sentryService } from '@/lib/services/sentry.service'

jest.mock('@/lib/services/sentry.service', () => ({
  sentryService: { handleWebhook: jest.fn() },
}))

function makeRequest(body: string, signature?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (signature) headers['sentry-hook-signature'] = signature
  return new NextRequest('http://x/api/webhooks/sentry', {
    method: 'POST',
    body,
    headers,
  })
}

describe('POST /api/webhooks/sentry', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 401 when service throws 401', async () => {
    ;(sentryService.handleWebhook as jest.Mock).mockRejectedValue(
      Object.assign(new Error('bad sig'), { status: 401 })
    )
    const res = await POST(makeRequest('{}', 'deadbeef'))
    expect(res.status).toBe(401)
  })

  it('returns 200 for unmapped project', async () => {
    ;(sentryService.handleWebhook as jest.Mock).mockResolvedValue({
      skipped: 'no_mapping',
    })
    const res = await POST(makeRequest('{}', 'abc'))
    expect(res.status).toBe(200)
  })

  it('returns 200 for created', async () => {
    ;(sentryService.handleWebhook as jest.Mock).mockResolvedValue({
      created: true,
      taskId: 't1',
    })
    const res = await POST(makeRequest('{}', 'abc'))
    expect(res.status).toBe(200)
  })

  it('returns 200 even when service throws a non-auth error', async () => {
    ;(sentryService.handleWebhook as jest.Mock).mockRejectedValue(
      new Error('db blew up')
    )
    const res = await POST(makeRequest('{}', 'abc'))
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- __tests__/api/webhooks/sentry-route.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Create `app/api/webhooks/sentry/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { sentryService } from '@/lib/services/sentry.service'

/**
 * POST /api/webhooks/sentry
 *
 * Receives Sentry Internal Integration webhooks. The orgSlug is extracted
 * from the payload's web_url host; the signature is verified with the
 * stored clientSecret. Unrecognized orgs → 404; bad signature → 401;
 * successful deliveries (including "skipped: no_mapping") → 200.
 * Internal errors after auth return 200 to prevent retry storms; they
 * are logged for investigation.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const signature = request.headers.get('sentry-hook-signature')

  try {
    const result = await sentryService.handleWebhook({ rawBody, signature })
    return NextResponse.json({ ok: true, result })
  } catch (err) {
    const status = (err as { status?: number }).status
    if (status === 400 || status === 401 || status === 404) {
      return NextResponse.json({ error: (err as Error).message }, { status })
    }
    console.error('[sentry/webhook] internal error:', err)
    return NextResponse.json({ ok: true })
  }
}
```

- [ ] **Step 4: Run to verify pass**

```bash
npm test -- __tests__/api/webhooks/sentry-route.test.ts
```

Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add app/api/webhooks/sentry/route.ts __tests__/api/webhooks/sentry-route.test.ts
git commit -m "feat: add /api/webhooks/sentry route [LUM-42]"
```

---

### Task 21: Frontend API client

**Files:**

- Create: `lib/api-client/sentry.ts`
- Modify: `app/workspace/[workspaceUrl]/constants.ts`

- [ ] **Step 1: Read the existing `constants.ts` for the `API` export shape**

Use Read tool on `app/workspace/[workspaceUrl]/constants.ts`. Find the `API` export and note the structure for Slack/GitHub.

- [ ] **Step 2: Extend `API` export with a `sentry` branch**

Add (adjust to match existing style):

```typescript
  sentry: {
    integration: '/api/sentry/integration',
    mappings: '/api/sentry/mappings',
  },
```

- [ ] **Step 3: Create `lib/api-client/sentry.ts`**

```typescript
import { apiFetch } from '@/lib/api-client'

export interface SentryStatus {
  connected: boolean
  orgSlug?: string
  lastWebhookAt?: string | null
  installedBy?: string | null
}

export interface SentryMapping {
  id: string
  sentryProjectSlug: string
  projectId: string
  project?: { id: string; name: string }
}

export const sentryApi = {
  getStatus(workspaceUrl: string): Promise<SentryStatus> {
    return apiFetch<SentryStatus>(
      `/api/sentry/integration?workspaceUrl=${encodeURIComponent(workspaceUrl)}`
    )
  },
  connect(
    workspaceUrl: string,
    data: { orgSlug: string; clientSecret: string }
  ): Promise<{ success: true; id: string }> {
    return apiFetch(
      `/api/sentry/integration?workspaceUrl=${encodeURIComponent(workspaceUrl)}`,
      { method: 'POST', body: JSON.stringify(data) }
    )
  },
  disconnect(workspaceUrl: string): Promise<{ success: true }> {
    return apiFetch(
      `/api/sentry/integration?workspaceUrl=${encodeURIComponent(workspaceUrl)}`,
      { method: 'DELETE' }
    )
  },
  listMappings(workspaceUrl: string): Promise<SentryMapping[]> {
    return apiFetch<SentryMapping[]>(
      `/api/sentry/mappings?workspaceUrl=${encodeURIComponent(workspaceUrl)}`
    )
  },
  createMapping(
    workspaceUrl: string,
    data: { sentryProjectSlug: string; projectId: string }
  ): Promise<SentryMapping> {
    return apiFetch<SentryMapping>(
      `/api/sentry/mappings?workspaceUrl=${encodeURIComponent(workspaceUrl)}`,
      { method: 'POST', body: JSON.stringify(data) }
    )
  },
  deleteMapping(workspaceUrl: string, id: string): Promise<{ success: true }> {
    return apiFetch(
      `/api/sentry/mappings/${id}?workspaceUrl=${encodeURIComponent(workspaceUrl)}`,
      { method: 'DELETE' }
    )
  },
}
```

- [ ] **Step 4: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/api-client/sentry.ts app/workspace/[workspaceUrl]/constants.ts
git commit -m "feat: add Sentry frontend API client [LUM-42]"
```

---

### Task 22: `SentryIntegrationCard` component

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/SentryIntegrationCard.tsx`

- [ ] **Step 1: Read `SlackIntegrationCard.tsx` for structure/style**

Use Read tool. Note the component's outer shell (card border, title, description, connect/disconnect buttons, loading state).

- [ ] **Step 2: Create `SentryIntegrationCard.tsx` modelled after it**

Key points:

- Props: `{ isOwner: boolean }`
- Fetches `sentryApi.getStatus(workspaceUrl)` on mount
- Disconnected: show "Connect Sentry" button → opens `SentryConnectDialog`
- Connected: show orgSlug, `lastWebhookAt` ("Last event received X ago" or "Waiting for first event"), "Manage mappings" button → `SentryMappingsDialog`, "Disconnect" button (OWNER only)
- Only OWNERs see Connect/Disconnect/Manage — gate on the `isOwner` prop
- Import `sentryApi` from `@/lib/api-client/sentry`
- Use lucide's `Bug` or `AlertTriangle` icon
- Mirror the existing Slack card's loading/error handling (use `toast.error` from `sonner`)

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import { AlertTriangle } from 'lucide-react'
import { sentryApi, type SentryStatus } from '@/lib/api-client/sentry'
import { SentryConnectDialog } from './SentryConnectDialog'
import { SentryMappingsDialog } from './SentryMappingsDialog'

export function SentryIntegrationCard({ isOwner }: { isOwner: boolean }) {
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const [status, setStatus] = useState<SentryStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [connectOpen, setConnectOpen] = useState(false)
  const [mappingsOpen, setMappingsOpen] = useState(false)

  const loadStatus = async () => {
    try {
      setStatus(await sentryApi.getStatus(workspaceUrl))
    } catch {
      toast.error('Failed to load Sentry status')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadStatus()
  }, [workspaceUrl])

  const handleDisconnect = async () => {
    if (!confirm('Disconnect Sentry? Existing tasks remain.')) return
    try {
      await sentryApi.disconnect(workspaceUrl)
      await loadStatus()
      toast.success('Sentry disconnected')
    } catch {
      toast.error('Failed to disconnect Sentry')
    }
  }

  if (loading) {
    return (
      <div className='h-32 rounded-xl border border-zinc-200 dark:border-zinc-800 animate-pulse bg-zinc-50 dark:bg-zinc-900' />
    )
  }

  const connected = status?.connected === true

  return (
    <>
      <div className='rounded-xl border border-zinc-200 dark:border-zinc-800 p-5'>
        <div className='flex items-start gap-3'>
          <div className='rounded-lg bg-red-500/10 p-2 text-red-500'>
            <AlertTriangle className='h-5 w-5' />
          </div>
          <div className='flex-1'>
            <h3 className='text-sm font-semibold text-zinc-900 dark:text-zinc-100'>
              Sentry
            </h3>
            <p className='mt-0.5 text-xs text-zinc-500 dark:text-zinc-400'>
              Automatically create tasks from Sentry alerts.
            </p>

            {connected ? (
              <div className='mt-3 text-xs text-zinc-600 dark:text-zinc-300'>
                <div>
                  Connected to{' '}
                  <span className='font-mono'>{status?.orgSlug}</span>
                </div>
                <div className='mt-0.5 text-zinc-500'>
                  {status?.lastWebhookAt
                    ? `Last verified webhook: ${new Date(status.lastWebhookAt).toLocaleString()}`
                    : 'Waiting for first verified webhook'}
                </div>
              </div>
            ) : null}
          </div>

          <div className='flex gap-2'>
            {!connected && isOwner && (
              <button
                className='text-xs px-3 py-1.5 rounded-md bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200'
                onClick={() => setConnectOpen(true)}
              >
                Connect
              </button>
            )}
            {connected && isOwner && (
              <>
                <button
                  className='text-xs px-3 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                  onClick={() => setMappingsOpen(true)}
                >
                  Manage mappings
                </button>
                <button
                  className='text-xs px-3 py-1.5 rounded-md text-red-500 hover:bg-red-500/10'
                  onClick={handleDisconnect}
                >
                  Disconnect
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <SentryConnectDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        onConnected={loadStatus}
      />
      <SentryMappingsDialog
        open={mappingsOpen}
        onOpenChange={setMappingsOpen}
      />
    </>
  )
}
```

- [ ] **Step 3: Typecheck (will fail until sibling dialogs exist)**

Expected: typecheck failures pointing to missing `SentryConnectDialog` / `SentryMappingsDialog`. Proceed to the next tasks — they create those files.

- [ ] **Step 4: Don't commit yet**

We'll commit all three UI components together after Tasks 23–24.

---

### Task 23: `SentryConnectDialog` component

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/SentryConnectDialog.tsx`

- [ ] **Step 1: Create the file**

Use the shadcn/ui `Dialog` pattern already used by `ProjectSlackDialog`. The dialog has two visible sections: the guide + the form. Keep it simple — a single scrollable body.

```tsx
'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { sentryApi } from '@/lib/api-client/sentry'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConnected: () => void
}

export function SentryConnectDialog({
  open,
  onOpenChange,
  onConnected,
}: Props) {
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const [orgSlug, setOrgSlug] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/webhooks/sentry`
      : ''

  const submit = async () => {
    setSubmitting(true)
    try {
      await sentryApi.connect(workspaceUrl, { orgSlug, clientSecret })
      toast.success(
        'Sentry connected. Send a test webhook from Sentry to verify.'
      )
      onConnected()
      onOpenChange(false)
      setOrgSlug('')
      setClientSecret('')
    } catch (err) {
      const msg = (err as Error).message || 'Failed to connect Sentry'
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>Connect Sentry</DialogTitle>
        </DialogHeader>

        <div className='space-y-4 text-sm'>
          <div>
            <p className='font-medium'>
              1. Create a Sentry Internal Integration
            </p>
            <p className='mt-1 text-xs text-zinc-500'>
              In Sentry, go to{' '}
              <code className='font-mono'>
                Organization Settings → Developer Settings → New Internal
                Integration
              </code>
              . Paste this webhook URL and enable "Issue Alert" under Alerts:
            </p>
            <div className='mt-2 flex items-center gap-2'>
              <code className='flex-1 rounded-md bg-zinc-100 dark:bg-zinc-800 px-2 py-1 font-mono text-xs break-all'>
                {webhookUrl}
              </code>
              <button
                className='text-xs px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-700'
                onClick={() => navigator.clipboard.writeText(webhookUrl)}
              >
                Copy
              </button>
            </div>
          </div>

          <div>
            <p className='font-medium'>2. Paste your Sentry details</p>
            <div className='mt-2 space-y-2'>
              <label className='block'>
                <span className='text-xs text-zinc-600 dark:text-zinc-300'>
                  Organization Slug
                </span>
                <input
                  className='mt-1 w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1 text-sm'
                  value={orgSlug}
                  onChange={e => setOrgSlug(e.target.value)}
                  placeholder='acme-inc'
                />
              </label>
              <label className='block'>
                <span className='text-xs text-zinc-600 dark:text-zinc-300'>
                  Client Secret
                </span>
                <input
                  type='password'
                  className='mt-1 w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1 text-sm'
                  value={clientSecret}
                  onChange={e => setClientSecret(e.target.value)}
                />
              </label>
            </div>
          </div>

          <div className='flex justify-end gap-2 pt-2'>
            <button
              className='text-xs px-3 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-700'
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              className='text-xs px-3 py-1.5 rounded-md bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50'
              onClick={submit}
              disabled={submitting || !orgSlug || !clientSecret}
            >
              {submitting ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Typecheck**

Expected: still failing on the missing `SentryMappingsDialog`. That is OK.

---

### Task 24: `SentryMappingsDialog` component

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/SentryMappingsDialog.tsx`

- [ ] **Step 1: Create the file**

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { sentryApi, type SentryMapping } from '@/lib/api-client/sentry'
import { apiFetch } from '@/lib/api-client'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface Project {
  id: string
  name: string
}

export function SentryMappingsDialog({ open, onOpenChange }: Props) {
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const [mappings, setMappings] = useState<SentryMapping[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [newSlug, setNewSlug] = useState('')
  const [newProjectId, setNewProjectId] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    Promise.all([
      sentryApi.listMappings(workspaceUrl),
      apiFetch<Project[]>(`/api/projects?workspaceUrl=${workspaceUrl}`),
    ])
      .then(([m, p]) => {
        setMappings(m)
        setProjects(p)
      })
      .catch(() => toast.error('Failed to load mappings'))
      .finally(() => setLoading(false))
  }, [open, workspaceUrl])

  const addMapping = async () => {
    if (!newSlug || !newProjectId) return
    setSubmitting(true)
    try {
      const created = await sentryApi.createMapping(workspaceUrl, {
        sentryProjectSlug: newSlug,
        projectId: newProjectId,
      })
      setMappings(prev => [...prev, created])
      setNewSlug('')
      setNewProjectId('')
      toast.success('Mapping added')
    } catch (err) {
      toast.error((err as Error).message || 'Failed to add mapping')
    } finally {
      setSubmitting(false)
    }
  }

  const removeMapping = async (id: string) => {
    try {
      await sentryApi.deleteMapping(workspaceUrl, id)
      setMappings(prev => prev.filter(m => m.id !== id))
    } catch {
      toast.error('Failed to remove mapping')
    }
  }

  const projectName = (pid: string) =>
    projects.find(p => p.id === pid)?.name ?? pid

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>Sentry project mappings</DialogTitle>
        </DialogHeader>
        <p className='text-xs text-zinc-500 dark:text-zinc-400'>
          Route Sentry alerts for a given Sentry project to a Lumo project. The
          slug is the last segment of{' '}
          <span className='font-mono'>
            /organizations/&lt;org&gt;/projects/&lt;slug&gt;/
          </span>
          .
        </p>

        <div className='mt-3 space-y-2'>
          {loading ? (
            <div className='text-xs text-zinc-500'>Loading…</div>
          ) : mappings.length === 0 ? (
            <div className='text-xs text-zinc-500'>No mappings yet.</div>
          ) : (
            mappings.map(m => (
              <div
                key={m.id}
                className='flex items-center justify-between rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-xs'
              >
                <div>
                  <span className='font-mono'>{m.sentryProjectSlug}</span>
                  <span className='mx-2 text-zinc-400'>→</span>
                  <span>{projectName(m.projectId)}</span>
                </div>
                <button
                  className='text-red-500 hover:bg-red-500/10 p-1 rounded'
                  onClick={() => removeMapping(m.id)}
                  aria-label='Remove mapping'
                >
                  <Trash2 className='h-4 w-4' />
                </button>
              </div>
            ))
          )}
        </div>

        <div className='mt-4 border-t border-zinc-200 dark:border-zinc-800 pt-3'>
          <p className='text-xs font-medium'>Add mapping</p>
          <div className='mt-2 flex items-end gap-2'>
            <label className='flex-1'>
              <span className='text-xs text-zinc-600 dark:text-zinc-300'>
                Sentry slug
              </span>
              <input
                className='mt-1 w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1 text-xs font-mono'
                value={newSlug}
                onChange={e => setNewSlug(e.target.value)}
                placeholder='frontend'
              />
            </label>
            <label className='flex-1'>
              <span className='text-xs text-zinc-600 dark:text-zinc-300'>
                Lumo project
              </span>
              <select
                className='mt-1 w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1 text-xs'
                value={newProjectId}
                onChange={e => setNewProjectId(e.target.value)}
              >
                <option value=''>—</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className='text-xs px-3 py-1.5 rounded-md bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50'
              disabled={submitting || !newSlug || !newProjectId}
              onClick={addMapping}
            >
              Add
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

> **Note:** the `apiFetch<Project[]>(/api/projects?...)` call assumes Lumo has an endpoint returning the workspace's projects. If it doesn't, use the route that `ProjectSlackDialog` uses to enumerate workspace projects — check that file and mirror.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 3: Commit Tasks 22–24 together**

```bash
git add app/workspace/[workspaceUrl]/components/SentryIntegrationCard.tsx \
        app/workspace/[workspaceUrl]/components/SentryConnectDialog.tsx \
        app/workspace/[workspaceUrl]/components/SentryMappingsDialog.tsx
git commit -m "feat: add Sentry integration UI components [LUM-42]"
```

---

### Task 25: Mount card in IntegrationsPage

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/pages/IntegrationsPage.tsx`

- [ ] **Step 1: Edit the file**

Add the import at the top:

```typescript
import { SentryIntegrationCard } from '../SentryIntegrationCard'
```

Inside the existing `<div className='space-y-4'>` block (where `GitHubIntegrationCard` and `SlackIntegrationCard` are rendered), add:

```tsx
<SentryIntegrationCard isOwner={isOwner} />
```

Place it after `<SlackIntegrationCard isOwner={isOwner} />`.

- [ ] **Step 2: Typecheck + dev-server sanity**

```bash
npx tsc --noEmit
```

Expected: exit 0. If possible, open the preview and navigate to Integrations — the card should render with a "Connect" button.

- [ ] **Step 3: Commit**

```bash
git add app/workspace/[workspaceUrl]/components/pages/IntegrationsPage.tsx
git commit -m "feat: mount Sentry card on integrations page [LUM-42]"
```

---

### Task 26: Render `SENTRY_ALERT` activity in task timeline

**Files:**

- Modify: whichever file renders `TaskActivity` items (find it in Step 1).

- [ ] **Step 1: Locate the task activity renderer**

Run:

```bash

```

Use Grep for `TaskActivityType.` or the existing enum values (e.g. `STATUS_CHANGED`, `ASSIGNED`) in `app/workspace/[workspaceUrl]/components/` to find the component(s) that render activity entries.

- [ ] **Step 2: Add a `case 'SENTRY_ALERT':` branch**

Add a rendering case that:

- Uses the lucide `AlertTriangle` icon (red)
- Renders text: "Sentry alert: <triggered_rule>" (falling back to `"Sentry alert received"` if metadata missing)
- If `metadata.reopened === true`, render "Reopened by Sentry regression"

Concrete shape (adjust to match the existing render pattern of the file you found):

```tsx
case 'SENTRY_ALERT': {
  const meta = (activity.metadata ?? {}) as {
    triggeredRule?: string
    reopened?: boolean
    eventCount?: number | null
  }
  const label = meta.reopened
    ? 'Reopened by Sentry regression'
    : meta.triggeredRule
      ? `Sentry alert: ${meta.triggeredRule}`
      : 'Sentry alert received'
  return (
    <div className='flex items-center gap-2 text-xs text-zinc-500'>
      <AlertTriangle className='h-3.5 w-3.5 text-red-500' />
      <span>{label}</span>
      {typeof meta.eventCount === 'number' ? (
        <span className='text-zinc-400'>· {meta.eventCount} events</span>
      ) : null}
    </div>
  )
}
```

Also: ensure the fallback branch (`default:` / unknown activity type) still renders something safe (not `undefined`).

- [ ] **Step 3: Typecheck + commit**

```bash
npx tsc --noEmit
git add <modified-file>
git commit -m "feat: render SENTRY_ALERT activity in task timeline [LUM-42]"
```

---

### Task 27: Full regression + PR

**Files:**

- None (CI run)

- [ ] **Step 1: Full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Full typecheck**

```bash
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 3: Lint if configured**

```bash
npm run lint --silent || true
```

Fix any issues.

- [ ] **Step 4: Grep for accidental `console.log`**

```bash

```

Use Grep for `console.log` restricted to the new files. Only `console.error` / `console.warn` are acceptable per CLAUDE.md.

- [ ] **Step 5: Push branch and open PR**

```bash
git push -u origin lumo/LUM-42-sentry-integration
gh pr create --title "feat: Sentry integration [LUM-42]" --body "$(cat <<'EOF'
## Summary
- Adds Sentry Internal Integration auth (orgSlug + clientSecret, AES-256-GCM at rest)
- Adds per-Sentry-project mapping to Lumo projects
- Webhook route verifies HMAC-SHA256 signatures and creates Lumo tasks with strict dedup
- Suggested-owner → assignee resolution via Clerk email lookup
- Automatic `bug` tag on created tasks
- Regression (Sentry alert on DONE task) reopens the task with a SENTRY_ALERT activity

Design spec: docs/superpowers/specs/2026-04-16-sentry-integration-design.md
Plan:        docs/superpowers/plans/2026-04-16-sentry-integration.md

## Test plan
- [x] Unit tests for verify/payload/mapping helpers
- [x] Service tests for connect/disconnect/mappings and handleWebhook matrix
- [x] Route tests for /api/sentry/integration, /api/sentry/mappings, /api/webhooks/sentry
- [ ] Manual: connect a real Sentry Internal Integration in staging, send a Test Request, see task created
- [ ] Manual: trigger a second alert for the same issue, see activity added (no duplicate task)
- [ ] Manual: mark task DONE, trigger regression, see task reopened
EOF
)"
```

- [ ] **Step 6: Update PR description with any packages added**

Per CLAUDE.md: "Never install new npm packages without noting it in PR description." This plan does not add any new packages, but double-check `git diff main -- package.json` and document if anything did change.

---

## Self-Review

Performed inline after writing the plan.

### Spec coverage

| Spec section                        | Covered by                              |
| ----------------------------------- | --------------------------------------- |
| Schema (3 models + enum)            | Task 1                                  |
| User Flow A (Connect)               | Tasks 22, 23, 18                        |
| User Flow B (Mappings)              | Tasks 24, 19, 14                        |
| User Flow C (Webhook)               | Tasks 16, 20                            |
| Task field mapping                  | Tasks 6, 7, 11, 15, 16                  |
| `buildTaskDescription` template     | Task 7                                  |
| Priority mapping                    | Task 4                                  |
| Assignee resolution                 | Tasks 10, 15, 16                        |
| Bug tag                             | Task 15                                 |
| Repeated alert + regression         | Tasks 12, 16                            |
| Error handling matrix               | Tasks 16, 18, 19, 20                    |
| Dedup via `SentryIssueLink`         | Tasks 1, 16                             |
| `lastWebhookAt` + Test webhook UX   | Tasks 1, 9, 16, 22                      |
| UI components                       | Tasks 22–25                             |
| Activity rendering (`SENTRY_ALERT`) | Task 26                                 |
| Testing strategy                    | Tasks 3, 5–7, 9–10, 11–12, 13–16, 18–20 |
| Fixtures                            | Task 2                                  |

All spec sections map to at least one task.

### Placeholder scan

- No "TBD" / "implement later" / "similar to Task N" in the plan.
- Two `> **Note:**` callouts ask the engineer to verify a real-code signature (`activityRepository.create`, `taskRepository.updateStatus`, `apiFetch<Project[]>('/api/projects')`) before finalizing the test/impl. These are pointers to known unknowns, not hand-waves — the engineer knows exactly what to verify and what to adjust if it differs.
- Task 10's test file appends rather than replaces. If the existing member.repository.test.ts has its own prisma mock, the engineer must align — noted explicitly.

### Type consistency

- `TaskPriority` used consistently as a Prisma enum (`@prisma/client` import).
- `TaskActivityType.SENTRY_ALERT` added in Task 1, referenced in Tasks 12, 16, 26.
- `extractIssueFields`'s return type `ExtractedIssueFields` defined in Task 2, used in Tasks 6, 7, 16.
- `sentryRepository.findMappingByProjectSlug` signature `(integrationId, sentryProjectSlug)` consistent between Task 9 implementation and Task 16 usage.
- `sentryService.handleWebhook` return type `{ created | repeated | skipped }` declared in Task 16 and matched by Task 20 route test expectations.
- `findActorsByEmailInWorkspace` signature `(workspaceId, emails[]) → string[]` consistent in Tasks 10 and 15.

---

Plan complete and saved to [docs/superpowers/plans/2026-04-16-sentry-integration.md](docs/superpowers/plans/2026-04-16-sentry-integration.md).
