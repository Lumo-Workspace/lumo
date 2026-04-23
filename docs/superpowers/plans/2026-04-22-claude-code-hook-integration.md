# Claude Code Hook Integration (Day 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Claude Code 的每次 tool 调用（PreToolUse / PostToolUse / Stop）通过 `lumo hook` CLI 子命令 POST 到 Lumo，落库为 `HookEvent`，作为 Runtime 观测的数据基础。

**Architecture:** 三层：(1) Prisma `HookEvent` 表按 workspace/member 归属，`payload` 存原始 JSON，`sessionId`/`taskId` 字段预留但 Day 3 为 null；(2) `POST /api/hooks/{pre-tool-use|post-tool-use|stop}` 三个 bearer-token 端点，共享 `handleHookRequest` handler；(3) `lumo hook <type>` 三个 CLI 子命令共享 `runHook()` helper：stdin 读 JSON → 读 `~/.lumo/credentials.json` → `fetch` 带 AbortController 超时 → 失败写 `~/.lumo/hook.log` → 始终 `exit 0`。

**Tech Stack:** Next.js 14 App Router, Prisma + Postgres, TypeScript, Node `fetch` + AbortController, Jest (Node env), Commander CLI.

---

## File Structure

**Create:**

- `prisma/migrations/20260422120000_add_hook_event/migration.sql` — create `hook_events` table + `HookEventType` enum + indexes.
- `lib/repositories/hook-event.repository.ts` — single `createHookEvent()` insert, returns `{ id }`.
- `lib/services/hook-event.service.ts` — `recordHookEvent({ identity, type, payload })`: extract `tool_name`, call repo.
- `lib/auth/bearer.ts` — `verifyBearer(request)` helper returning `VerifyApiKeyResult | null`.
- `app/api/hooks/_handler.ts` — shared `handleHookRequest(request, type)` used by all three routes.
- `app/api/hooks/pre-tool-use/route.ts` — 5-line wrapper calling handler.
- `app/api/hooks/post-tool-use/route.ts` — 5-line wrapper calling handler.
- `app/api/hooks/stop/route.ts` — 5-line wrapper calling handler.
- `cli/src/lib/hook-log.ts` — `logHookError(message)` appends to `~/.lumo/hook.log`.
- `cli/src/lib/hook-runner.ts` — `runHook(type)` shared implementation (stdin + POST + tolerant).
- `cli/src/commands/hook.ts` — three thin exports: `hookPreToolUse`, `hookPostToolUse`, `hookStop`.
- `__tests__/lib/repositories/hook-event.repository.test.ts`
- `__tests__/lib/services/hook-event.service.test.ts`
- `__tests__/lib/auth/bearer.test.ts`
- `__tests__/app/api/hooks/route.integration.test.ts`
- `docs/setup-claude-code-hooks.md` — user setup guide.

**Modify:**

- `prisma/schema.prisma` — append `HookEventType` enum + `HookEvent` model; add `hookEvents` relation to `WorkspaceMember` and `Workspace`.
- `cli/src/index.ts` — register `lumo hook {pre-tool-use,post-tool-use,stop}` subcommands.

---

## Task 1: Prisma `HookEvent` Model + Migration

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260422120000_add_hook_event/migration.sql`

- [ ] **Step 1: Append enum + model to `prisma/schema.prisma`**

Append at the end of the schema file:

```prisma
// ─── Hook Events (Claude Code runtime observability) ────────────────────────

enum HookEventType {
  PRE_TOOL_USE
  POST_TOOL_USE
  STOP
}

model HookEvent {
  id                String        @id @default(cuid())
  workspaceId       String
  workspaceMemberId String
  sessionId         String?       // Day 4: Claude Code session ID
  taskId            String?       // Day 4: associated Lumo task
  type              HookEventType
  toolName          String?       // extracted from payload.tool_name when present
  payload           Json          // raw hook body from Claude Code
  createdAt         DateTime      @default(now())

  workspace Workspace       @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  member    WorkspaceMember @relation(fields: [workspaceMemberId], references: [id], onDelete: Cascade)

  @@index([workspaceId, createdAt])
  @@index([workspaceMemberId, createdAt])
  @@map("hook_events")
}
```

- [ ] **Step 2: Add back-relations to `Workspace` and `WorkspaceMember`**

In `prisma/schema.prisma` find `model Workspace {` (~line 147) and add inside the relation block:

```prisma
  hookEvents HookEvent[]
```

Find `model WorkspaceMember {` (~line 235) and add next to `apiKeys`:

```prisma
  hookEvents HookEvent[]
```

- [ ] **Step 3: Create migration SQL**

Create file `prisma/migrations/20260422120000_add_hook_event/migration.sql`:

```sql
-- CreateEnum
CREATE TYPE "HookEventType" AS ENUM ('PRE_TOOL_USE', 'POST_TOOL_USE', 'STOP');

-- CreateTable
CREATE TABLE "hook_events" (
    "id"                TEXT            NOT NULL,
    "workspaceId"       TEXT            NOT NULL,
    "workspaceMemberId" TEXT            NOT NULL,
    "sessionId"         TEXT,
    "taskId"            TEXT,
    "type"              "HookEventType" NOT NULL,
    "toolName"          TEXT,
    "payload"           JSONB           NOT NULL,
    "createdAt"         TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hook_events_workspaceId_createdAt_idx"       ON "hook_events" ("workspaceId", "createdAt");
CREATE INDEX "hook_events_workspaceMemberId_createdAt_idx" ON "hook_events" ("workspaceMemberId", "createdAt");

-- AddForeignKey
ALTER TABLE "hook_events"
  ADD CONSTRAINT "hook_events_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "hook_events"
  ADD CONSTRAINT "hook_events_workspaceMemberId_fkey"
  FOREIGN KEY ("workspaceMemberId") REFERENCES "workspace_members"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 4: Run Prisma generate + migrate**

Run: `npx prisma migrate dev --name add_hook_event`
Expected: "✔ Generated Prisma Client" and migration applied. (If running in CI without DB, just `npx prisma generate` — skip `migrate dev`.)

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260422120000_add_hook_event
git commit -m "feat(hooks): add HookEvent model for Claude Code runtime events [LUM-Day3]"
```

---

## Task 2: `hook-event.repository.ts` (TDD)

**Files:**

- Create: `lib/repositories/hook-event.repository.ts`
- Test: `__tests__/lib/repositories/hook-event.repository.test.ts`

- [ ] **Step 1: Write failing test**

Create `__tests__/lib/repositories/hook-event.repository.test.ts`:

```ts
/**
 * @jest-environment node
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    hookEvent: {
      create: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'

const mockCreate = prisma.hookEvent.create as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
})

describe('hookEventRepository.createHookEvent', () => {
  it('inserts a hook event with all fields and returns id', async () => {
    mockCreate.mockResolvedValue({ id: 'he_1' })

    const result = await hookEventRepository.createHookEvent({
      workspaceId: 'ws_1',
      workspaceMemberId: 'wm_1',
      type: 'PRE_TOOL_USE',
      toolName: 'Read',
      payload: { tool_name: 'Read', tool_input: { file_path: '/tmp/x' } },
    })

    expect(result).toEqual({ id: 'he_1' })
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        workspaceId: 'ws_1',
        workspaceMemberId: 'wm_1',
        sessionId: null,
        taskId: null,
        type: 'PRE_TOOL_USE',
        toolName: 'Read',
        payload: { tool_name: 'Read', tool_input: { file_path: '/tmp/x' } },
      },
      select: { id: true },
    })
  })

  it('allows null toolName for Stop events', async () => {
    mockCreate.mockResolvedValue({ id: 'he_2' })

    await hookEventRepository.createHookEvent({
      workspaceId: 'ws_1',
      workspaceMemberId: 'wm_1',
      type: 'STOP',
      toolName: null,
      payload: { reason: 'user-ctrl-c' },
    })

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ toolName: null }),
      })
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/repositories/hook-event.repository.test.ts`
Expected: FAIL with `Cannot find module '@/lib/repositories/hook-event.repository'`.

- [ ] **Step 3: Implement repository**

Create `lib/repositories/hook-event.repository.ts`:

```ts
import { prisma } from '@/lib/db/prisma'
import type { HookEventType, Prisma } from '@prisma/client'

interface CreateHookEventData {
  workspaceId: string
  workspaceMemberId: string
  type: HookEventType
  toolName: string | null
  payload: Prisma.InputJsonValue
  sessionId?: string | null
  taskId?: string | null
}

export const hookEventRepository = {
  async createHookEvent(data: CreateHookEventData) {
    return prisma.hookEvent.create({
      data: {
        workspaceId: data.workspaceId,
        workspaceMemberId: data.workspaceMemberId,
        sessionId: data.sessionId ?? null,
        taskId: data.taskId ?? null,
        type: data.type,
        toolName: data.toolName,
        payload: data.payload,
      },
      select: { id: true },
    })
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/repositories/hook-event.repository.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/hook-event.repository.ts __tests__/lib/repositories/hook-event.repository.test.ts
git commit -m "feat(hooks): add hookEventRepository.createHookEvent [LUM-Day3]"
```

---

## Task 3: `hook-event.service.ts` (TDD)

**Files:**

- Create: `lib/services/hook-event.service.ts`
- Test: `__tests__/lib/services/hook-event.service.test.ts`

- [ ] **Step 1: Write failing test**

Create `__tests__/lib/services/hook-event.service.test.ts`:

```ts
/**
 * @jest-environment node
 */
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: {
    createHookEvent: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: {
    findMemberIdForHook: jest.fn(),
  },
}))

import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { hookEventService } from '@/lib/services/hook-event.service'

const repo = hookEventRepository as jest.Mocked<typeof hookEventRepository>
const misc = miscRepository as jest.Mocked<typeof miscRepository>

const identity = {
  user: { id: 'clerk_1', email: 'a@b.c', name: 'A' },
  workspace: { id: 'ws_1', slug: 'ws', name: 'WS' },
  apiKey: { id: 'key_1', name: 'laptop', prefix: 'lum_abc' },
}

beforeEach(() => {
  jest.clearAllMocks()
  misc.findMemberIdForHook.mockResolvedValue('wm_1')
  repo.createHookEvent.mockResolvedValue({ id: 'he_1' } as never)
})

describe('hookEventService.recordHookEvent', () => {
  it('extracts tool_name from payload for PRE_TOOL_USE', async () => {
    await hookEventService.recordHookEvent({
      identity,
      type: 'PRE_TOOL_USE',
      payload: { tool_name: 'Read', tool_input: { file_path: '/x' } },
    })

    expect(repo.createHookEvent).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      workspaceMemberId: 'wm_1',
      type: 'PRE_TOOL_USE',
      toolName: 'Read',
      payload: { tool_name: 'Read', tool_input: { file_path: '/x' } },
    })
  })

  it('stores null toolName when payload has no tool_name', async () => {
    await hookEventService.recordHookEvent({
      identity,
      type: 'STOP',
      payload: { stop_reason: 'user' },
    })

    expect(repo.createHookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'STOP', toolName: null })
    )
  })

  it('coerces non-string tool_name to null', async () => {
    await hookEventService.recordHookEvent({
      identity,
      type: 'POST_TOOL_USE',
      payload: { tool_name: 42 },
    })

    expect(repo.createHookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: null })
    )
  })
})
```

- [ ] **Step 2: Add a repository method to resolve member id from clerkId + workspaceId**

Edit `lib/repositories/misc.repository.ts` — append inside the `miscRepository` object, before the closing `}`:

```ts
  // ── HookEvent helper ───────────────────────────────────────────────────

  /** Resolve workspaceMember.id from clerkId + workspaceId (hook ingestion). */
  async findMemberIdForHook(clerkId: string, workspaceId: string) {
    const row = await prisma.workspaceMember.findUnique({
      where: { workspaceId_clerkId: { workspaceId, clerkId } },
      select: { id: true },
    })
    return row?.id ?? null
  },
```

- [ ] **Step 3: Run service test to verify it fails**

Run: `npx jest __tests__/lib/services/hook-event.service.test.ts`
Expected: FAIL with `Cannot find module '@/lib/services/hook-event.service'`.

- [ ] **Step 4: Implement service**

Create `lib/services/hook-event.service.ts`:

```ts
import type { HookEventType, Prisma } from '@prisma/client'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'
import type { VerifyApiKeyResult } from '@/lib/services/auth.service'

interface RecordHookEventInput {
  identity: VerifyApiKeyResult
  type: HookEventType
  payload: Prisma.InputJsonValue
}

function extractToolName(payload: unknown): string | null {
  if (payload && typeof payload === 'object') {
    const value = (payload as Record<string, unknown>).tool_name
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

export const hookEventService = {
  async recordHookEvent({ identity, type, payload }: RecordHookEventInput) {
    const memberId = await miscRepository.findMemberIdForHook(
      identity.user.id,
      identity.workspace.id
    )
    if (!memberId) {
      const err: Error & { status?: number } = new Error(
        'Workspace member not found for API key holder'
      )
      err.status = 403
      throw err
    }

    return hookEventRepository.createHookEvent({
      workspaceId: identity.workspace.id,
      workspaceMemberId: memberId,
      type,
      toolName: extractToolName(payload),
      payload,
    })
  },
}
```

- [ ] **Step 5: Run service test to verify it passes**

Run: `npx jest __tests__/lib/services/hook-event.service.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/services/hook-event.service.ts lib/repositories/misc.repository.ts __tests__/lib/services/hook-event.service.test.ts
git commit -m "feat(hooks): add hookEventService.recordHookEvent with tool_name extraction [LUM-Day3]"
```

---

## Task 4: Bearer-Auth Helper (TDD)

**Files:**

- Create: `lib/auth/bearer.ts`
- Test: `__tests__/lib/auth/bearer.test.ts`

- [ ] **Step 1: Write failing test**

Create `__tests__/lib/auth/bearer.test.ts`:

```ts
/**
 * @jest-environment node
 */
jest.mock('@/lib/services/auth.service', () => ({
  authService: { verifyApiKey: jest.fn() },
}))

import { authService } from '@/lib/services/auth.service'
import { verifyBearer } from '@/lib/auth/bearer'

const mockVerify = authService.verifyApiKey as jest.Mock

beforeEach(() => jest.clearAllMocks())

function req(header?: string): Request {
  const h = new Headers()
  if (header !== undefined) h.set('Authorization', header)
  return new Request('http://x/', { headers: h })
}

describe('verifyBearer', () => {
  it('returns null when Authorization header is missing', async () => {
    expect(await verifyBearer(req())).toBeNull()
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('returns null when header does not start with Bearer', async () => {
    expect(await verifyBearer(req('Basic abc'))).toBeNull()
  })

  it('returns null when token is empty', async () => {
    expect(await verifyBearer(req('Bearer   '))).toBeNull()
  })

  it('returns null when authService rejects the key', async () => {
    mockVerify.mockResolvedValue(null)
    expect(await verifyBearer(req('Bearer lum_bad'))).toBeNull()
  })

  it('returns identity when token is valid', async () => {
    const identity = { user: {}, workspace: {}, apiKey: {} }
    mockVerify.mockResolvedValue(identity)
    expect(await verifyBearer(req('Bearer lum_good'))).toBe(identity)
    expect(mockVerify).toHaveBeenCalledWith('lum_good')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/auth/bearer.test.ts`
Expected: FAIL with `Cannot find module '@/lib/auth/bearer'`.

- [ ] **Step 3: Implement helper**

Create `lib/auth/bearer.ts`:

```ts
import {
  authService,
  type VerifyApiKeyResult,
} from '@/lib/services/auth.service'

export async function verifyBearer(
  request: Request
): Promise<VerifyApiKeyResult | null> {
  const header = request.headers.get('Authorization')
  if (!header || !header.startsWith('Bearer ')) return null
  const token = header.slice(7).trim()
  if (!token) return null
  return authService.verifyApiKey(token)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/auth/bearer.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/auth/bearer.ts __tests__/lib/auth/bearer.test.ts
git commit -m "feat(auth): add verifyBearer helper for bearer-token API routes [LUM-Day3]"
```

---

## Task 5: Hook API Routes (TDD)

**Files:**

- Create: `app/api/hooks/_handler.ts`
- Create: `app/api/hooks/pre-tool-use/route.ts`
- Create: `app/api/hooks/post-tool-use/route.ts`
- Create: `app/api/hooks/stop/route.ts`
- Test: `__tests__/app/api/hooks/route.integration.test.ts`

- [ ] **Step 1: Write failing integration test**

Create `__tests__/app/api/hooks/route.integration.test.ts`:

```ts
/**
 * @jest-environment node
 */
jest.mock('@/lib/services/auth.service', () => ({
  authService: { verifyApiKey: jest.fn() },
}))
jest.mock('@/lib/services/hook-event.service', () => ({
  hookEventService: { recordHookEvent: jest.fn() },
}))

import { authService } from '@/lib/services/auth.service'
import { hookEventService } from '@/lib/services/hook-event.service'
import { POST as postPre } from '@/app/api/hooks/pre-tool-use/route'
import { POST as postPost } from '@/app/api/hooks/post-tool-use/route'
import { POST as postStop } from '@/app/api/hooks/stop/route'

const mockVerify = authService.verifyApiKey as jest.Mock
const mockRecord = hookEventService.recordHookEvent as jest.Mock

const identity = {
  user: { id: 'clerk_1', email: 'a@b', name: 'A' },
  workspace: { id: 'ws_1', slug: 'ws', name: 'WS' },
  apiKey: { id: 'k_1', name: 'laptop', prefix: 'lum_abc' },
}

function post(
  url: string,
  body: unknown,
  headers: Record<string, string> = {}
) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockVerify.mockResolvedValue(identity)
  mockRecord.mockResolvedValue({ id: 'he_1' })
})

describe('POST /api/hooks/pre-tool-use', () => {
  it('returns 401 when Authorization header missing', async () => {
    const res = await postPre(post('http://x/api/hooks/pre-tool-use', {}))
    expect(res.status).toBe(401)
  })

  it('returns 401 when bearer token invalid', async () => {
    mockVerify.mockResolvedValue(null)
    const res = await postPre(
      post(
        'http://x/api/hooks/pre-tool-use',
        {},
        { Authorization: 'Bearer bad' }
      )
    )
    expect(res.status).toBe(401)
  })

  it('returns 400 on malformed JSON body', async () => {
    const req = new Request('http://x/api/hooks/pre-tool-use', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer lum_ok',
      },
      body: '{not-json',
    })
    const res = await postPre(req)
    expect(res.status).toBe(400)
  })

  it('records PRE_TOOL_USE event and returns {ok:true}', async () => {
    const payload = { tool_name: 'Read', tool_input: { file_path: '/x' } }
    const res = await postPre(
      post('http://x/api/hooks/pre-tool-use', payload, {
        Authorization: 'Bearer lum_ok',
      })
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mockRecord).toHaveBeenCalledWith({
      identity,
      type: 'PRE_TOOL_USE',
      payload,
    })
  })
})

describe('POST /api/hooks/post-tool-use', () => {
  it('records POST_TOOL_USE event', async () => {
    const res = await postPost(
      post(
        'http://x/api/hooks/post-tool-use',
        { tool_name: 'Edit' },
        { Authorization: 'Bearer lum_ok' }
      )
    )
    expect(res.status).toBe(200)
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'POST_TOOL_USE' })
    )
  })
})

describe('POST /api/hooks/stop', () => {
  it('records STOP event', async () => {
    const res = await postStop(
      post(
        'http://x/api/hooks/stop',
        { stop_reason: 'user' },
        { Authorization: 'Bearer lum_ok' }
      )
    )
    expect(res.status).toBe(200)
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'STOP' })
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/app/api/hooks/route.integration.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement shared handler**

Create `app/api/hooks/_handler.ts`:

```ts
import { NextResponse } from 'next/server'
import type { HookEventType } from '@prisma/client'
import { verifyBearer } from '@/lib/auth/bearer'
import { hookEventService } from '@/lib/services/hook-event.service'

const UNAUTHORIZED = { error: 'Invalid or revoked API key' }

export async function handleHookRequest(
  request: Request,
  type: HookEventType
): Promise<Response> {
  try {
    const identity = await verifyBearer(request)
    if (!identity) return NextResponse.json(UNAUTHORIZED, { status: 401 })

    let payload: unknown
    try {
      payload = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    await hookEventService.recordHookEvent({
      identity,
      type,
      payload: (payload ??
        {}) as import('@prisma/client').Prisma.InputJsonValue,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error(`POST /api/hooks/${type} error:`, error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 4: Implement three route files**

Create `app/api/hooks/pre-tool-use/route.ts`:

```ts
import { handleHookRequest } from '@/app/api/hooks/_handler'

export async function POST(request: Request) {
  return handleHookRequest(request, 'PRE_TOOL_USE')
}
```

Create `app/api/hooks/post-tool-use/route.ts`:

```ts
import { handleHookRequest } from '@/app/api/hooks/_handler'

export async function POST(request: Request) {
  return handleHookRequest(request, 'POST_TOOL_USE')
}
```

Create `app/api/hooks/stop/route.ts`:

```ts
import { handleHookRequest } from '@/app/api/hooks/_handler'

export async function POST(request: Request) {
  return handleHookRequest(request, 'STOP')
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest __tests__/app/api/hooks/route.integration.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add app/api/hooks __tests__/app/api/hooks
git commit -m "feat(hooks): add POST /api/hooks/{pre-tool-use,post-tool-use,stop} endpoints [LUM-Day3]"
```

---

## Task 6: CLI Shared Hook Runner

**Files:**

- Create: `cli/src/lib/hook-log.ts`
- Create: `cli/src/lib/hook-runner.ts`

- [ ] **Step 1: Implement log helper**

Create `cli/src/lib/hook-log.ts`:

```ts
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

function logDir(): string {
  return path.join(os.homedir(), '.lumo')
}

function logPath(): string {
  return path.join(logDir(), 'hook.log')
}

/**
 * Append an error line to ~/.lumo/hook.log. Swallows all failures — hook
 * commands must never crash Claude Code, even if the log path is unwritable.
 */
export function logHookError(context: string, error: unknown): void {
  try {
    const dir = logDir()
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { mode: 0o700, recursive: true })
    }
    const msg = error instanceof Error ? error.message : String(error)
    const line = `${new Date().toISOString()} [${context}] ${msg}\n`
    fs.appendFileSync(logPath(), line, { mode: 0o600 })
  } catch {
    // Intentionally silent — never disturb the host CLI.
  }
}
```

- [ ] **Step 2: Implement runner**

Create `cli/src/lib/hook-runner.ts`:

```ts
import { readCredentials } from './config'
import { trimTrailingSlash } from './api'
import { logHookError } from './hook-log'

export type HookType = 'pre-tool-use' | 'post-tool-use' | 'stop'

const TIMEOUT_MS = 1500

function readStdin(): Promise<string> {
  return new Promise(resolve => {
    if (process.stdin.isTTY) {
      resolve('')
      return
    }
    let buf = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => {
      buf += chunk
    })
    process.stdin.on('end', () => resolve(buf))
    process.stdin.on('error', () => resolve(buf))
  })
}

/**
 * Hook command entrypoint: read hook JSON from stdin, POST to Lumo, exit 0.
 *
 * Never throws, never exits non-zero — Claude Code must not be disturbed by
 * Lumo infrastructure issues.
 */
export async function runHook(type: HookType): Promise<void> {
  try {
    const body = await readStdin()

    // Validate we have JSON (if empty, still log an event with {} payload)
    let parsed: unknown = {}
    if (body.trim().length > 0) {
      try {
        parsed = JSON.parse(body)
      } catch (err) {
        logHookError(type, `invalid stdin JSON: ${err}`)
        return
      }
    }

    const creds = readCredentials()
    if (!creds) {
      logHookError(type, 'no credentials; run `lumo auth login`')
      return
    }

    const url = `${trimTrailingSlash(creds.apiUrl)}/api/hooks/${type}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${creds.token}`,
        },
        body: JSON.stringify(parsed),
        signal: controller.signal,
      })
      if (!res.ok) {
        logHookError(type, `HTTP ${res.status} from ${url}`)
      }
    } catch (err) {
      logHookError(type, err)
    } finally {
      clearTimeout(timer)
    }
  } catch (err) {
    logHookError(type, err)
  }
}
```

- [ ] **Step 3: Build the CLI to catch type errors**

Run: `cd cli && npx tsc --noEmit`
Expected: no output (success).

- [ ] **Step 4: Commit**

```bash
git add cli/src/lib/hook-log.ts cli/src/lib/hook-runner.ts
git commit -m "feat(cli): add shared hook runner with stdin POST + silent error log [LUM-Day3]"
```

---

## Task 7: CLI `lumo hook` Subcommands

**Files:**

- Create: `cli/src/commands/hook.ts`
- Modify: `cli/src/index.ts`

- [ ] **Step 1: Implement command wrappers**

Create `cli/src/commands/hook.ts`:

```ts
import { runHook } from '../lib/hook-runner'

export async function hookPreToolUse(): Promise<void> {
  await runHook('pre-tool-use')
}

export async function hookPostToolUse(): Promise<void> {
  await runHook('post-tool-use')
}

export async function hookStop(): Promise<void> {
  await runHook('stop')
}
```

- [ ] **Step 2: Register subcommands in `cli/src/index.ts`**

Edit `cli/src/index.ts` — add imports at the top and register subcommands.

Add to imports block (after existing `whoami` import):

```ts
import { hookPreToolUse, hookPostToolUse, hookStop } from './commands/hook'
```

Add after the `whoami` command registration (before `program.parseAsync`):

```ts
const hook = program
  .command('hook')
  .description(
    'Claude Code hook endpoints (invoked by Claude Code settings.json)'
  )

hook
  .command('pre-tool-use')
  .description('Record a Claude Code PreToolUse event (reads JSON from stdin)')
  .action(wrap(hookPreToolUse))

hook
  .command('post-tool-use')
  .description('Record a Claude Code PostToolUse event (reads JSON from stdin)')
  .action(wrap(hookPostToolUse))

hook
  .command('stop')
  .description('Record a Claude Code Stop event (reads JSON from stdin)')
  .action(wrap(hookStop))
```

- [ ] **Step 3: Ensure `wrap()` tolerates hook commands**

Note: the existing `wrap()` catches throws and exits 1. `runHook()` never throws, so hook commands always reach exit 0. No changes required.

- [ ] **Step 4: Build the CLI**

Run: `cd cli && npm run build`
Expected: `dist/index.js` regenerated, no tsc errors.

- [ ] **Step 5: Smoke-check the binary**

Run: `cd cli && node dist/index.js hook --help`
Expected output contains `pre-tool-use`, `post-tool-use`, `stop` subcommands.

- [ ] **Step 6: Commit**

```bash
git add cli/src/commands/hook.ts cli/src/index.ts cli/dist
git commit -m "feat(cli): add \`lumo hook\` subcommands for Claude Code hook ingestion [LUM-Day3]"
```

---

## Task 8: Setup Documentation

**Files:**

- Create: `docs/setup-claude-code-hooks.md`

- [ ] **Step 1: Write the doc**

Create `docs/setup-claude-code-hooks.md`:

````markdown
# Configure Claude Code to Report to Lumo

Once configured, every tool call Claude Code makes in your terminal is recorded
in Lumo as a `HookEvent`.

## Prerequisites

1. `lumo auth login` — you must already be logged in with a valid API key.
   Run `lumo whoami` to confirm.
2. The `lumo` binary must be on your `$PATH`.

## Enable hooks in Claude Code

Create (or edit) one of:

- **Project-scoped:** `<repo>/.claude/settings.json`
- **Global:** `~/.claude/settings.json`

Add:

```json
{
  "hooks": {
    "PreToolUse": [{ "type": "command", "command": "lumo hook pre-tool-use" }],
    "PostToolUse": [
      { "type": "command", "command": "lumo hook post-tool-use" }
    ],
    "Stop": [{ "type": "command", "command": "lumo hook stop" }]
  }
}
```
````

Save, then run `claude` (or `claude code`). Every tool invocation now flows into
the Lumo `hook_events` table.

## Troubleshooting

- Hook errors are intentionally silent to avoid breaking Claude Code. Inspect
  `~/.lumo/hook.log` to see what went wrong.
- If events are not appearing, confirm `lumo whoami` works and that
  `LUMO_API_URL` (if you set one) points at the running Lumo API.
- The hook client times out after 1.5s — a slow Lumo API will silently drop
  events rather than block Claude Code.

````

- [ ] **Step 2: Commit**

```bash
git add docs/setup-claude-code-hooks.md
git commit -m "docs(hooks): add Claude Code hook configuration guide [LUM-Day3]"
````

---

## Task 9: End-to-End Verification

**Files:** none (manual verification)

- [ ] **Step 1: Run the full Jest suite for new code**

Run: `npx jest __tests__/lib/repositories/hook-event.repository.test.ts __tests__/lib/services/hook-event.service.test.ts __tests__/lib/auth/bearer.test.ts __tests__/app/api/hooks/route.integration.test.ts`
Expected: all green.

- [ ] **Step 2: Type-check the whole repo**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual curl test**

In one shell run: `npm run dev` (wait until Next.js is listening on :3000).

In another shell with an active login (`lumo whoami` works), read the token:

```bash
TOKEN=$(jq -r .token ~/.lumo/credentials.json)
curl -sS -X POST http://localhost:3000/api/hooks/pre-tool-use \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tool_name":"Read","tool_input":{"file_path":"/tmp/test.txt"}}'
```

Expected: `{"ok":true}`.

- [ ] **Step 4: Confirm the row in Prisma Studio or SQL**

Run: `npx prisma studio` → open `hook_events` → confirm one row with `type=PRE_TOOL_USE`, `toolName=Read`, `payload` intact.

- [ ] **Step 5: Pipe through the CLI**

Run:

```bash
echo '{"tool_name":"Edit","tool_input":{"file_path":"/tmp/x"}}' | node cli/dist/index.js hook post-tool-use
```

Expected: no stdout/stderr, exit 0. A new row appears in `hook_events` with
`type=POST_TOOL_USE`, `toolName=Edit`.

- [ ] **Step 6: Failure tolerance smoke test**

Stop the Next.js dev server. Run:

```bash
echo '{}' | node cli/dist/index.js hook stop
echo "exit=$?"
```

Expected: `exit=0`. Check `~/.lumo/hook.log` — a line with today's timestamp
and the connection error is present.

- [ ] **Step 7: Real Claude Code round-trip**

Write a minimal `.claude/settings.json` in any sandbox directory per the doc
from Task 8, making `command` point at the repo's local CLI binary
(`./cli/dist/index.js` or install the package locally). Restart the Next.js
dev server. Launch `claude`, ask it to read one file, exit. Check
`hook_events` — expect at least one `PRE_TOOL_USE` + one `POST_TOOL_USE` row
with the correct `toolName`.

- [ ] **Step 8: Commit the plan log (optional)**

If execution notes are worth keeping, amend only the plan checklist state and
commit. Otherwise stop.
