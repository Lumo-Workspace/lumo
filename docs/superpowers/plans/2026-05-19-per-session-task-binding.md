# Per-Session Task Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the global `~/.lumo/current-task.json` with per-session sentinel files keyed by `CLAUDE_CODE_SESSION_ID`, eliminating cross-contamination between parallel Claude Code sessions (TRAP #2 of LUM-40).

**Architecture:** A new CLI module `lib/session-binding.ts` stores one JSON file per Claude Code session under `~/.lumo/sessions/<session_id>.json`. The hook runner extracts `session_id` from the hook payload and looks up the per-session file to inject `task_id`. `lumo session attach` requires `CLAUDE_CODE_SESSION_ID` in the env, calls the existing `/api/sessions/<sid>/bind-task` endpoint, and writes the per-session file. `lumo session start` is removed. The server-side `/api/sessions/attach` endpoint and its service method are deleted.

**Tech Stack:** Node.js + TypeScript CLI (`cli/src/`); Next.js + Prisma server (`app/api/`, `lib/services/`, `lib/repositories/`); Jest tests in `__tests__/`.

**Spec:** `docs/superpowers/specs/2026-05-19-per-session-task-binding-design.md`

---

## File Structure

**CLI (new / modified):**

- `cli/src/lib/session-binding.ts` (NEW) — per-session sentinel I/O: `readSessionBinding`, `writeSessionBinding`, `clearSessionBinding`, `cleanupStaleBindings`, `migrateLegacyCurrentTask`. Single responsibility: filesystem layer.
- `cli/src/lib/hook-runner.ts` (MOD) — `injectCurrentTaskId(body)` → `injectTaskId(body, hookType, sessionId)`; `runHook(path)` splits into a stdin-reading shell and a testable `runHookWithBody(path, body)` worker. The worker parses `sessionId` once, passes it to `injectTaskId`, and after a successful POST executes `clearSessionBinding` (for `session-end`) or `cleanupStaleBindings` (for `session-start`).
- `cli/src/commands/session-attach.ts` (MOD) — read `CLAUDE_CODE_SESSION_ID`, POST `/api/sessions/<sid>/bind-task`, write per-session file.
- `cli/src/commands/session-start.ts` (DELETE) — semantic gone with the global file.
- `cli/src/lib/current-task.ts` (DELETE) — replaced by `session-binding.ts`.
- `cli/src/index.ts` (MOD) — call `migrateLegacyCurrentTask()` at startup; unregister `session start` subcommand.

**Server (modified / deleted):**

- `app/api/sessions/attach/route.ts` (DELETE) — replaced by per-session `/api/sessions/<sid>/bind-task`.
- `lib/services/session.service.ts` (MOD) — delete `attachToTask` + `AttachToTaskInput`/`AttachToTaskResult`; extend `bindSessionToTask` to return `retaggedEventCount`.
- `lib/repositories/session.repository.ts` (MOD) — delete `findMostRecentForMember` (unused after attachToTask removal).

**Tests:**

- `__tests__/cli/session-binding.test.ts` (NEW)
- `__tests__/cli/migrate-legacy.test.ts` (NEW)
- `__tests__/cli/session-attach.test.ts` (NEW)
- `__tests__/cli/hook-runner-inject.test.ts` (REWRITE — pure `injectTaskId` tests)
- `__tests__/cli/hook-runner-side-effects.test.ts` (NEW — `runHookWithBody` side-effect tests)
- `__tests__/cli/current-task.test.ts` (DELETE)
- `__tests__/lib/services/session-service-bind.test.ts` (MOD — assert new `retaggedEventCount`)

**Documentation:**

- `.claude/skills/lumo/SKILL.md` (MOD) — delete `### lumo session start <identifier>` section; update `### lumo session attach <identifier>` description.

---

## Task 1: Extend `bindSessionToTask` to return `retaggedEventCount`

**Files:**

- Modify: `lib/services/session.service.ts` (interface `BindSessionToTaskResult` and method body)
- Test: `__tests__/lib/services/session-service-bind.test.ts`

- [ ] **Step 1: Update the existing test to assert the new field**

Edit `__tests__/lib/services/session-service-bind.test.ts`, the test `'binds session to task and re-tags null events'` (around line 64). Change the final `expect(result).toEqual(...)` block to:

```ts
expect(result).toEqual({
  taskId: 'task_1',
  taskIdentifier: 'LUM-42',
  taskTitle: 'Fix login bug',
  retaggedEventCount: 3,
})
```

(The mock `bulkSetTaskIdForNullEventsInSession` already returns `{ count: 3 }` in `beforeEach`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/lib/services/session-service-bind.test.ts -t "binds session to task"`
Expected: FAIL with `Expected: { ..., retaggedEventCount: 3 } Received: { ... }` (no retaggedEventCount).

- [ ] **Step 3: Implement the change**

In `lib/services/session.service.ts`:

a) Update the `BindSessionToTaskResult` interface (around line 26):

```ts
interface BindSessionToTaskResult {
  taskId: string
  taskIdentifier: string
  taskTitle: string
  retaggedEventCount: number
}
```

b) In `bindSessionToTask` (around line 95), capture the bulk-update count and include it in the return value. The current code is:

```ts
await sessionRepository.updateTaskId(sessionId, task.id)
await hookEventRepository.bulkSetTaskIdForNullEventsInSession(
  sessionId,
  task.id
)

return {
  taskId: task.id,
  taskIdentifier: task.identifier,
  taskTitle: task.title,
}
```

Replace with:

```ts
await sessionRepository.updateTaskId(sessionId, task.id)
const { count } = await hookEventRepository.bulkSetTaskIdForNullEventsInSession(
  sessionId,
  task.id
)

return {
  taskId: task.id,
  taskIdentifier: task.identifier,
  taskTitle: task.title,
  retaggedEventCount: count,
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/lib/services/session-service-bind.test.ts`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (Callers of `bindSessionToTask` — the `bind-task` route — already spread the result through `NextResponse.json`, so the extra field flows through without code change.)

- [ ] **Step 6: Commit**

```bash
git add lib/services/session.service.ts __tests__/lib/services/session-service-bind.test.ts
git commit -m "feat: return retaggedEventCount from bindSessionToTask [LUM-40]"
```

---

## Task 2: Create `session-binding.ts` with read/write/clear

**Files:**

- Create: `cli/src/lib/session-binding.ts`
- Test: `__tests__/cli/session-binding.test.ts` (NEW)

- [ ] **Step 1: Write the failing test**

Create `__tests__/cli/session-binding.test.ts`:

```ts
/**
 * @jest-environment node
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  readSessionBinding,
  writeSessionBinding,
  clearSessionBinding,
  sessionBindingPath,
  sessionBindingDir,
} from '@/cli/src/lib/session-binding'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumo-session-binding-'))
const configDir = path.join(tmpRoot, 'lumo-cfg')
const originalEnv = process.env.LUMO_CONFIG_DIR

beforeEach(() => {
  process.env.LUMO_CONFIG_DIR = configDir
  if (fs.existsSync(configDir)) {
    fs.rmSync(configDir, { recursive: true, force: true })
  }
})

afterAll(() => {
  if (originalEnv === undefined) delete process.env.LUMO_CONFIG_DIR
  else process.env.LUMO_CONFIG_DIR = originalEnv
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

const sample = {
  taskId: 'cmoc_abc',
  taskIdentifier: 'LUM-40',
  taskTitle: 'Parallel sessions',
  workspaceSlug: 'lumo',
  startedAt: '2026-05-19T12:00:00.000Z',
}

describe('session-binding', () => {
  it('returns null when no binding file exists for the session', () => {
    expect(readSessionBinding('S1')).toBeNull()
  })

  it('round-trips write → read for a given sessionId', () => {
    writeSessionBinding('S1', sample)
    expect(readSessionBinding('S1')).toEqual(sample)
  })

  it('keeps bindings per-sessionId isolated', () => {
    const other = { ...sample, taskIdentifier: 'LUM-50' }
    writeSessionBinding('S1', sample)
    writeSessionBinding('S2', other)
    expect(readSessionBinding('S1')).toEqual(sample)
    expect(readSessionBinding('S2')).toEqual(other)
  })

  it('writes per-session files under <configDir>/sessions/<sid>.json with 0600', () => {
    writeSessionBinding('S1', sample)
    const p = sessionBindingPath('S1')
    expect(p).toBe(path.join(configDir, 'sessions', 'S1.json'))
    expect(fs.statSync(p).mode & 0o777).toBe(0o600)
  })

  it('creates the sessions directory with 0700 when missing', () => {
    expect(fs.existsSync(sessionBindingDir())).toBe(false)
    writeSessionBinding('S1', sample)
    expect(fs.statSync(sessionBindingDir()).mode & 0o777).toBe(0o700)
  })

  it('returns null on malformed JSON rather than throwing', () => {
    fs.mkdirSync(sessionBindingDir(), { recursive: true })
    fs.writeFileSync(sessionBindingPath('S1'), '{not json')
    expect(readSessionBinding('S1')).toBeNull()
  })

  it('returns null when a required field is missing', () => {
    writeSessionBinding('S1', sample)
    const partial = { ...sample, taskTitle: undefined as unknown as string }
    fs.writeFileSync(sessionBindingPath('S1'), JSON.stringify(partial))
    expect(readSessionBinding('S1')).toBeNull()
  })

  it('clearSessionBinding removes the file and reports the deletion', () => {
    writeSessionBinding('S1', sample)
    expect(clearSessionBinding('S1')).toBe(true)
    expect(readSessionBinding('S1')).toBeNull()
  })

  it('clearSessionBinding returns false when nothing to clear', () => {
    expect(clearSessionBinding('S1')).toBe(false)
  })

  it('clearing one session does not touch another', () => {
    writeSessionBinding('S1', sample)
    writeSessionBinding('S2', sample)
    expect(clearSessionBinding('S1')).toBe(true)
    expect(readSessionBinding('S2')).toEqual(sample)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/cli/session-binding.test.ts`
Expected: FAIL with module-not-found for `@/cli/src/lib/session-binding`.

- [ ] **Step 3: Implement the module**

Create `cli/src/lib/session-binding.ts`:

```ts
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export interface SessionBinding {
  taskId: string
  taskIdentifier: string
  taskTitle: string
  workspaceSlug: string
  startedAt: string
}

function configDir(): string {
  return process.env.LUMO_CONFIG_DIR || path.join(os.homedir(), '.lumo')
}

export function sessionBindingDir(): string {
  return path.join(configDir(), 'sessions')
}

export function sessionBindingPath(sessionId: string): string {
  return path.join(sessionBindingDir(), `${sessionId}.json`)
}

export function readSessionBinding(sessionId: string): SessionBinding | null {
  const p = sessionBindingPath(sessionId)
  if (!fs.existsSync(p)) return null
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'))
    if (
      typeof data?.taskId !== 'string' ||
      typeof data?.taskIdentifier !== 'string' ||
      typeof data?.taskTitle !== 'string' ||
      typeof data?.workspaceSlug !== 'string' ||
      typeof data?.startedAt !== 'string'
    ) {
      return null
    }
    return data as SessionBinding
  } catch {
    return null
  }
}

export function writeSessionBinding(
  sessionId: string,
  binding: SessionBinding
): void {
  const dir = sessionBindingDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { mode: 0o700, recursive: true })
  }
  fs.writeFileSync(
    sessionBindingPath(sessionId),
    JSON.stringify(binding, null, 2),
    { mode: 0o600 }
  )
}

export function clearSessionBinding(sessionId: string): boolean {
  const p = sessionBindingPath(sessionId)
  if (!fs.existsSync(p)) return false
  fs.unlinkSync(p)
  return true
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/cli/session-binding.test.ts`
Expected: PASS (all 10 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/src/lib/session-binding.ts __tests__/cli/session-binding.test.ts
git commit -m "feat: add per-session binding I/O module [LUM-40]"
```

---

## Task 3: Add `cleanupStaleBindings`

**Files:**

- Modify: `cli/src/lib/session-binding.ts` (add function)
- Modify: `__tests__/cli/session-binding.test.ts` (add tests)

- [ ] **Step 1: Add failing tests**

Append to `__tests__/cli/session-binding.test.ts` (inside the `describe('session-binding', ...)` block, after the last test):

```ts
describe('cleanupStaleBindings', () => {
  function setMtimeDaysAgo(p: string, days: number): void {
    const t = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    fs.utimesSync(p, t, t)
  }

  it('deletes files older than threshold and keeps fresh ones', () => {
    writeSessionBinding('old', sample)
    writeSessionBinding('fresh', sample)
    setMtimeDaysAgo(sessionBindingPath('old'), 10)
    // 'fresh' keeps its current mtime (just now)

    const removed = cleanupStaleBindings(7)

    expect(removed).toBe(1)
    expect(fs.existsSync(sessionBindingPath('old'))).toBe(false)
    expect(fs.existsSync(sessionBindingPath('fresh'))).toBe(true)
  })

  it('returns 0 when the sessions directory does not exist', () => {
    expect(cleanupStaleBindings(7)).toBe(0)
  })

  it('returns 0 when no files exceed the threshold', () => {
    writeSessionBinding('S1', sample)
    writeSessionBinding('S2', sample)
    expect(cleanupStaleBindings(7)).toBe(0)
    expect(fs.existsSync(sessionBindingPath('S1'))).toBe(true)
    expect(fs.existsSync(sessionBindingPath('S2'))).toBe(true)
  })

  it('ignores non-JSON files in the directory', () => {
    writeSessionBinding('S1', sample)
    const dir = sessionBindingDir()
    fs.writeFileSync(path.join(dir, 'README'), 'noise')
    const noiseStat = path.join(dir, 'README')
    const t = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    fs.utimesSync(noiseStat, t, t)
    expect(cleanupStaleBindings(7)).toBe(0)
    expect(fs.existsSync(noiseStat)).toBe(true)
  })
})
```

Also add `cleanupStaleBindings` to the import at the top of the file:

```ts
import {
  readSessionBinding,
  writeSessionBinding,
  clearSessionBinding,
  sessionBindingPath,
  sessionBindingDir,
  cleanupStaleBindings,
} from '@/cli/src/lib/session-binding'
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/cli/session-binding.test.ts -t "cleanupStaleBindings"`
Expected: FAIL with `cleanupStaleBindings is not a function` or import error.

- [ ] **Step 3: Implement the function**

Add to `cli/src/lib/session-binding.ts` (after `clearSessionBinding`):

```ts
/**
 * Delete per-session binding files whose mtime is older than `olderThanDays`.
 * Only touches files ending in `.json` — any other content in the directory
 * is ignored. Single-file unlink failures are logged via console.error and
 * skipped (the loop continues), so a permission glitch on one file never
 * blocks cleanup of the rest. Returns the number of files actually removed.
 */
export function cleanupStaleBindings(olderThanDays: number): number {
  const dir = sessionBindingDir()
  if (!fs.existsSync(dir)) return 0
  const cutoffMs = Date.now() - olderThanDays * 24 * 60 * 60 * 1000
  let removed = 0
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith('.json')) continue
    const p = path.join(dir, entry)
    try {
      const stat = fs.statSync(p)
      if (stat.mtimeMs >= cutoffMs) continue
      fs.unlinkSync(p)
      removed++
    } catch (err) {
      console.error(`[session-binding] cleanup skipped ${entry}: ${err}`)
    }
  }
  return removed
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/cli/session-binding.test.ts`
Expected: PASS (all 14 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/src/lib/session-binding.ts __tests__/cli/session-binding.test.ts
git commit -m "feat: add cleanupStaleBindings for orphan per-session files [LUM-40]"
```

---

## Task 4: Add `migrateLegacyCurrentTask`

**Files:**

- Modify: `cli/src/lib/session-binding.ts`
- Create: `__tests__/cli/migrate-legacy.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/cli/migrate-legacy.test.ts`:

```ts
/**
 * @jest-environment node
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { migrateLegacyCurrentTask } from '@/cli/src/lib/session-binding'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumo-migrate-'))
const configDir = path.join(tmpRoot, 'lumo-cfg')
const originalEnv = process.env.LUMO_CONFIG_DIR

beforeEach(() => {
  process.env.LUMO_CONFIG_DIR = configDir
  if (fs.existsSync(configDir)) {
    fs.rmSync(configDir, { recursive: true, force: true })
  }
})

afterAll(() => {
  if (originalEnv === undefined) delete process.env.LUMO_CONFIG_DIR
  else process.env.LUMO_CONFIG_DIR = originalEnv
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('migrateLegacyCurrentTask', () => {
  it('returns false when the legacy file does not exist', () => {
    expect(migrateLegacyCurrentTask()).toBe(false)
  })

  it('deletes the legacy file when present and returns true', () => {
    fs.mkdirSync(configDir, { recursive: true })
    const legacy = path.join(configDir, 'current-task.json')
    fs.writeFileSync(legacy, '{"taskId":"x"}')
    expect(migrateLegacyCurrentTask()).toBe(true)
    expect(fs.existsSync(legacy)).toBe(false)
  })

  it('is idempotent across calls', () => {
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(path.join(configDir, 'current-task.json'), '{}')
    expect(migrateLegacyCurrentTask()).toBe(true)
    expect(migrateLegacyCurrentTask()).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/cli/migrate-legacy.test.ts`
Expected: FAIL with `migrateLegacyCurrentTask is not exported` or similar.

- [ ] **Step 3: Implement the function**

Append to `cli/src/lib/session-binding.ts`:

```ts
/**
 * One-shot migration: remove the legacy `~/.lumo/current-task.json` file
 * that older CLI versions used as a global task pointer. The new per-session
 * design under `~/.lumo/sessions/` supersedes it; the legacy file is never
 * read again. Returns true if a file was deleted, false if nothing to do.
 *
 * We do NOT translate the legacy content to a per-session file: the bound
 * session may already be dead, and the user can rebind explicitly with
 * `lumo session attach`.
 */
export function migrateLegacyCurrentTask(): boolean {
  const legacy = path.join(configDir(), 'current-task.json')
  if (!fs.existsSync(legacy)) return false
  try {
    fs.unlinkSync(legacy)
    return true
  } catch (err) {
    console.error(`[session-binding] legacy migration skipped: ${err}`)
    return false
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/cli/migrate-legacy.test.ts`
Expected: PASS (all 3 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/src/lib/session-binding.ts __tests__/cli/migrate-legacy.test.ts
git commit -m "feat: add migrateLegacyCurrentTask helper [LUM-40]"
```

---

## Task 5: Rewrite `injectCurrentTaskId` → `injectTaskId` against session-binding

**Files:**

- Modify: `cli/src/lib/hook-runner.ts`
- Rewrite: `__tests__/cli/hook-runner-inject.test.ts`

- [ ] **Step 1: Rewrite the test file**

Replace the entire contents of `__tests__/cli/hook-runner-inject.test.ts` with:

```ts
/**
 * @jest-environment node
 */
jest.mock('@/cli/src/lib/session-binding', () => ({
  readSessionBinding: jest.fn(),
}))

import { readSessionBinding } from '@/cli/src/lib/session-binding'
import { injectTaskId } from '@/cli/src/lib/hook-runner'

const mockRead = readSessionBinding as jest.Mock

const sample = {
  taskId: 'cmoc_abc',
  taskIdentifier: 'LUM-40',
  taskTitle: 'x',
  workspaceSlug: 'lumo',
  startedAt: '2026-05-19T12:00:00.000Z',
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('injectTaskId', () => {
  it('injects task_id when the per-session binding exists', () => {
    mockRead.mockReturnValue(sample)
    const out = injectTaskId(
      '{"session_id":"S1","cwd":"/r"}',
      'pre-tool-use',
      'S1'
    )
    expect(mockRead).toHaveBeenCalledWith('S1')
    expect(JSON.parse(out)).toEqual({
      session_id: 'S1',
      cwd: '/r',
      task_id: 'cmoc_abc',
    })
  })

  it('returns body unchanged when no per-session binding exists', () => {
    mockRead.mockReturnValue(null)
    const body = '{"session_id":"S1"}'
    expect(injectTaskId(body, 'pre-tool-use', 'S1')).toBe(body)
  })

  it('does not inject for session-start even if a binding exists', () => {
    mockRead.mockReturnValue(sample)
    const body = '{"session_id":"S1"}'
    expect(injectTaskId(body, 'session-start', 'S1')).toBe(body)
    expect(mockRead).not.toHaveBeenCalled()
  })

  it('does not inject when sessionId is null', () => {
    mockRead.mockReturnValue(sample)
    const body = '{"cwd":"/r"}'
    expect(injectTaskId(body, 'pre-tool-use', null)).toBe(body)
    expect(mockRead).not.toHaveBeenCalled()
  })

  it('falls back to "{}" when body is empty and sessionId is null', () => {
    mockRead.mockReturnValue(null)
    expect(injectTaskId('', 'pre-tool-use', null)).toBe('{}')
  })

  it('synthesizes a minimal body when stdin is empty but a binding exists', () => {
    mockRead.mockReturnValue(sample)
    expect(JSON.parse(injectTaskId('', 'pre-tool-use', 'S1'))).toEqual({
      task_id: 'cmoc_abc',
    })
  })

  it('passes through malformed JSON bodies without injecting', () => {
    mockRead.mockReturnValue(sample)
    const body = '{not json'
    expect(injectTaskId(body, 'pre-tool-use', 'S1')).toBe(body)
  })

  it('does not inject into non-object JSON (arrays, scalars)', () => {
    mockRead.mockReturnValue(sample)
    expect(injectTaskId('[1,2,3]', 'pre-tool-use', 'S1')).toBe('[1,2,3]')
    expect(injectTaskId('"hi"', 'pre-tool-use', 'S1')).toBe('"hi"')
  })

  it('overrides a stale task_id already present in the payload', () => {
    mockRead.mockReturnValue(sample)
    const out = injectTaskId('{"task_id":"stale"}', 'pre-tool-use', 'S1')
    expect(JSON.parse(out)).toEqual({ task_id: 'cmoc_abc' })
  })

  it('keeps per-sessionId lookups isolated', () => {
    mockRead.mockImplementation((sid: string) =>
      sid === 'S1'
        ? { ...sample, taskId: 'task_for_S1' }
        : sid === 'S2'
          ? { ...sample, taskId: 'task_for_S2' }
          : null
    )
    expect(
      JSON.parse(injectTaskId('{"session_id":"S1"}', 'pre-tool-use', 'S1'))
        .task_id
    ).toBe('task_for_S1')
    expect(
      JSON.parse(injectTaskId('{"session_id":"S2"}', 'pre-tool-use', 'S2'))
        .task_id
    ).toBe('task_for_S2')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/cli/hook-runner-inject.test.ts`
Expected: FAIL — `injectTaskId is not exported` from `hook-runner.ts`.

- [ ] **Step 3: Implement `injectTaskId` and rewire `runHook` in hook-runner.ts**

In `cli/src/lib/hook-runner.ts`:

a) Replace the top imports:

```ts
import { readCredentials } from './config'
import { trimTrailingSlash } from './api'
import { readSessionBinding } from './session-binding'
import { logHookError } from './hook-log'
```

(Remove the `readCurrentTask` import.)

b) Replace the entire `injectCurrentTaskId` function with `injectTaskId` (just below the JSDoc — rewrite the JSDoc too):

```ts
/**
 * Merge the per-session binding's `taskId` (if any) into the hook JSON body
 * as a top-level `task_id` field. Always returns a non-empty JSON string so
 * the POST body is valid even when stdin is empty or malformed.
 *
 * The lookup is keyed by `sessionId` (parsed from the hook payload by the
 * caller) — there is no global sentinel any more, so parallel Claude Code
 * sessions cannot pollute each other.
 *
 * No injection happens when:
 *   - `hookType === 'session-start'` (the session row may not even exist
 *     server-side yet; binding is set later by `lumo session attach`)
 *   - `sessionId` is null (hook payload had no session_id)
 *   - no per-session binding file exists
 *   - the parsed body isn't a JSON object
 *
 * Failures always degrade silently — we never block Claude Code for hook
 * enrichment.
 */
export function injectTaskId(
  body: string,
  hookType: HookPath,
  sessionId: string | null
): string {
  if (hookType === 'session-start' || !sessionId) {
    return body || '{}'
  }
  const binding = readSessionBinding(sessionId)
  if (!binding) return body || '{}'
  if (!body) return JSON.stringify({ task_id: binding.taskId })
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return body
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return body
  }
  return JSON.stringify({
    ...(parsed as Record<string, unknown>),
    task_id: binding.taskId,
  })
}
```

c) Add a private helper near the top of the file (after `readStdin`):

```ts
function extractSessionId(body: string): string | null {
  if (!body) return null
  try {
    const parsed = JSON.parse(body)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const sid = (parsed as Record<string, unknown>).session_id
      if (typeof sid === 'string' && sid.length > 0) return sid
    }
  } catch {
    // ignore — malformed body, treat as no session_id
  }
  return null
}
```

d) Refactor `runHook` to split into a thin stdin-reading shell + a testable worker. Replace the entire `runHook` function with:

```ts
/**
 * POST the hook body to /api/hooks/<path> with a short timeout. All errors
 * — credential missing, network failure, timeout, non-2xx — are routed to
 * hook.log and then the caller exits 0.
 *
 * This function NEVER throws and NEVER rejects.
 */
export async function runHook(path: HookPath): Promise<void> {
  const body = await readStdin()
  return runHookWithBody(path, body)
}

/**
 * Test-friendly worker. Takes the hook body as an argument so tests can
 * exercise the side-effect logic without poking process.stdin. Production
 * code always goes through `runHook`, which feeds it real stdin.
 */
export async function runHookWithBody(
  path: HookPath,
  body: string
): Promise<void> {
  try {
    const creds = readCredentials()
    if (!creds) {
      logHookError(`[${path}]`, 'no credentials; skipping')
      return
    }

    const sessionId = extractSessionId(body)
    const enriched = injectTaskId(body, path, sessionId)
    const envUrl = process.env.LUMO_API_URL?.trim()
    const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl
    const url = `${trimTrailingSlash(apiUrl)}/api/hooks/${path}`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${creds.token}`,
        },
        body: enriched,
        signal: controller.signal,
      })
      if (!res.ok) {
        logHookError(`[${path}]`, `HTTP ${res.status} from ${url}`)
      } else if (path === 'session-start') {
        try {
          const responseBody = await res.json()
          const output = formatSessionStartOutput(responseBody)
          if (output) process.stdout.write(output + '\n')
        } catch {
          // response body parse failure is non-fatal
        }
      }
    } catch (err) {
      logHookError(`[${path}]`, err)
    } finally {
      clearTimeout(timer)
    }
  } catch (err) {
    logHookError(`[${path}] runner`, err)
  }
}
```

(Task 6 adds the new side-effect logic into `runHookWithBody`; for now the body is identical to the old `runHook` minus the stdin read.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/cli/hook-runner-inject.test.ts`
Expected: PASS (all 10 tests).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (The old `current-task.ts` file is still on disk and imported only by `session-start.ts` / `session-attach.ts`, which haven't been changed yet — those still compile.)

- [ ] **Step 6: Commit**

```bash
git add cli/src/lib/hook-runner.ts __tests__/cli/hook-runner-inject.test.ts
git commit -m "refactor: key task_id injection by per-session binding [LUM-40]"
```

---

## Task 6: Add side effects — `cleanupStaleBindings` on session-start, `clearSessionBinding` on session-end

**Files:**

- Modify: `cli/src/lib/hook-runner.ts`
- Modify: `__tests__/cli/hook-runner-inject.test.ts` (add side-effect tests at the bottom)

- [ ] **Step 1: Write failing tests**

Create a separate test file `__tests__/cli/hook-runner-side-effects.test.ts` (keeping it separate from the inject tests avoids mock-state crosstalk):

```ts
/**
 * @jest-environment node
 */
const cleanup = jest.fn()
const clear = jest.fn()

jest.mock('@/cli/src/lib/session-binding', () => ({
  readSessionBinding: jest.fn().mockReturnValue(null),
  cleanupStaleBindings: cleanup,
  clearSessionBinding: clear,
}))
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn().mockReturnValue({
    token: 't',
    apiUrl: 'http://x',
    workspaceSlug: 'w',
  }),
}))
jest.mock('@/cli/src/lib/hook-log', () => ({
  logHookError: jest.fn(),
}))

import { runHookWithBody } from '@/cli/src/lib/hook-runner'

const originalFetch = global.fetch

beforeEach(() => {
  cleanup.mockReset()
  clear.mockReset()
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({}),
  }) as unknown as typeof fetch
})

afterAll(() => {
  global.fetch = originalFetch
})

describe('runHookWithBody side effects', () => {
  it('calls cleanupStaleBindings(7) after a successful session-start POST', async () => {
    await runHookWithBody('session-start', '{"session_id":"S1"}')
    expect(cleanup).toHaveBeenCalledWith(7)
    expect(clear).not.toHaveBeenCalled()
  })

  it('calls clearSessionBinding(sessionId) after a successful session-end POST', async () => {
    await runHookWithBody('session-end', '{"session_id":"S1"}')
    expect(clear).toHaveBeenCalledWith('S1')
    expect(cleanup).not.toHaveBeenCalled()
  })

  it('does not call clearSessionBinding when session-end has no session_id', async () => {
    await runHookWithBody('session-end', '{}')
    expect(clear).not.toHaveBeenCalled()
  })

  it('does not call side effects when POST failed', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    }) as unknown as typeof fetch
    await runHookWithBody('session-end', '{"session_id":"S1"}')
    expect(clear).not.toHaveBeenCalled()
    expect(cleanup).not.toHaveBeenCalled()
  })

  it('does not call cleanup or clear for unrelated hook types', async () => {
    await runHookWithBody('pre-tool-use', '{"session_id":"S1"}')
    expect(cleanup).not.toHaveBeenCalled()
    expect(clear).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/cli/hook-runner-inject.test.ts -t "runHook side effects"`
Expected: FAIL — side effects not yet implemented.

- [ ] **Step 3: Implement side effects in `runHook`**

In `cli/src/lib/hook-runner.ts`:

a) Update the import from `./session-binding` to include the side-effect helpers:

```ts
import {
  readSessionBinding,
  cleanupStaleBindings,
  clearSessionBinding,
} from './session-binding'
```

b) Inside `runHookWithBody` (NOT `runHook` — see Task 5 split), locate the success-branch where `res.ok` is true. Currently it only handles `path === 'session-start'` by parsing the body and writing to stdout. Wrap that branch and add the side-effect logic. Replace this section:

```ts
if (!res.ok) {
  logHookError(`[${path}]`, `HTTP ${res.status} from ${url}`)
} else if (path === 'session-start') {
  try {
    const body = await res.json()
    const output = formatSessionStartOutput(body)
    if (output) process.stdout.write(output + '\n')
  } catch {
    // response body parse failure is non-fatal
  }
}
```

with:

```ts
if (!res.ok) {
  logHookError(`[${path}]`, `HTTP ${res.status} from ${url}`)
} else {
  // Per-hook side effects fire only after a 2xx response so a transient
  // server failure doesn't desync local state from server state.
  if (path === 'session-start') {
    try {
      const responseBody = await res.json()
      const output = formatSessionStartOutput(responseBody)
      if (output) process.stdout.write(output + '\n')
    } catch {
      // response body parse failure is non-fatal
    }
    try {
      cleanupStaleBindings(7)
    } catch (err) {
      logHookError(`[${path}] cleanup`, err)
    }
  } else if (path === 'session-end' && sessionId) {
    try {
      clearSessionBinding(sessionId)
    } catch (err) {
      logHookError(`[${path}] clear`, err)
    }
  }
}
```

(The `sessionId` variable is already in scope from Task 5.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/cli/hook-runner-side-effects.test.ts __tests__/cli/hook-runner-inject.test.ts`
Expected: PASS — 5 side-effect tests + 10 inject tests = 15 total.

- [ ] **Step 5: Commit**

```bash
git add cli/src/lib/hook-runner.ts __tests__/cli/hook-runner-side-effects.test.ts
git commit -m "feat: clear per-session binding on session-end, cleanup on session-start [LUM-40]"
```

---

## Task 7: Rewrite `session-attach` to use env + bind-task endpoint + per-session file

**Files:**

- Rewrite: `cli/src/commands/session-attach.ts`
- Create: `__tests__/cli/session-attach.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/cli/session-attach.test.ts`:

```ts
/**
 * @jest-environment node
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(),
}))
jest.mock('@/cli/src/lib/session-binding', () => ({
  writeSessionBinding: jest.fn(),
}))

import { readCredentials } from '@/cli/src/lib/config'
import { writeSessionBinding } from '@/cli/src/lib/session-binding'
import { sessionAttach } from '@/cli/src/commands/session-attach'

const mockRead = readCredentials as jest.Mock
const mockWrite = writeSessionBinding as jest.Mock

const originalEnv = process.env.CLAUDE_CODE_SESSION_ID
let consoleErrorSpy: jest.SpyInstance
let consoleLogSpy: jest.SpyInstance

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.CLAUDE_CODE_SESSION_ID
  mockRead.mockReturnValue({
    token: 't',
    apiUrl: 'http://x',
    workspaceSlug: 'lumo',
  })
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  consoleErrorSpy.mockRestore()
  consoleLogSpy.mockRestore()
  if (originalEnv === undefined) delete process.env.CLAUDE_CODE_SESSION_ID
  else process.env.CLAUDE_CODE_SESSION_ID = originalEnv
})

describe('sessionAttach', () => {
  it('exits 1 when CLAUDE_CODE_SESSION_ID env is not set', async () => {
    const exit = await sessionAttach('LUM-42')
    expect(exit).toBe(1)
    expect(mockWrite).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('CLAUDE_CODE_SESSION_ID')
    )
  })

  it('exits 1 when identifier is missing', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = 'S1'
    const exit = await sessionAttach(undefined)
    expect(exit).toBe(1)
    expect(mockWrite).not.toHaveBeenCalled()
  })

  it('exits 1 when credentials are missing', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = 'S1'
    mockRead.mockReturnValue(null)
    const exit = await sessionAttach('LUM-42')
    expect(exit).toBe(1)
    expect(mockWrite).not.toHaveBeenCalled()
  })

  it('POSTs to /api/sessions/<sid>/bind-task and writes per-session file on 200', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = 'S1'
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        taskId: 'task_1',
        taskIdentifier: 'LUM-42',
        taskTitle: 'Fix bug',
        retaggedEventCount: 3,
      }),
    } as Response)

    const exit = await sessionAttach('LUM-42')

    expect(exit).toBeUndefined()
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://x/api/sessions/S1/bind-task',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ taskIdentifier: 'LUM-42' }),
      })
    )
    expect(mockWrite).toHaveBeenCalledWith(
      'S1',
      expect.objectContaining({
        taskId: 'task_1',
        taskIdentifier: 'LUM-42',
        taskTitle: 'Fix bug',
        workspaceSlug: 'lumo',
      })
    )
    fetchSpy.mockRestore()
  })

  it('exits 1 and does not write file when server returns 404', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = 'S1'
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Task LUM-999 not found in workspace' }),
    } as Response)

    const exit = await sessionAttach('LUM-999')

    expect(exit).toBe(1)
    expect(mockWrite).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('exits 1 and does not write file when server returns 401', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = 'S1'
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    } as Response)

    const exit = await sessionAttach('LUM-42')

    expect(exit).toBe(1)
    expect(mockWrite).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('exits 1 and does not write file when fetch throws', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = 'S1'
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('ECONNREFUSED'))

    const exit = await sessionAttach('LUM-42')

    expect(exit).toBe(1)
    expect(mockWrite).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/cli/session-attach.test.ts`
Expected: FAIL — current `sessionAttach` doesn't gate on env, posts to `/api/sessions/attach`, etc.

- [ ] **Step 3: Rewrite `cli/src/commands/session-attach.ts`**

Replace the entire file with:

```ts
import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'
import { writeSessionBinding } from '../lib/session-binding'

interface BindResponse {
  taskId: string
  taskIdentifier: string
  taskTitle: string
  retaggedEventCount: number
}

/**
 * `lumo session attach <identifier>` — bind the currently-running
 * Claude Code session to a task.
 *
 * Required environment: `CLAUDE_CODE_SESSION_ID` (set automatically by
 * Claude Code). Must be invoked from inside a Claude Code session — there
 * is no longer a global "current task" pointer for terminals outside CC.
 *
 * Calls `POST /api/sessions/<sid>/bind-task` and, on success, writes a
 * per-session sentinel file at `~/.lumo/sessions/<sid>.json` so all
 * subsequent hooks tag their events with this task.
 */
export async function sessionAttach(
  identifier: string | undefined
): Promise<number | void> {
  if (!identifier) {
    console.error(
      'Error: missing <identifier>. Usage: lumo session attach <LUM-42>'
    )
    return 1
  }

  const sessionId = process.env.CLAUDE_CODE_SESSION_ID
  if (!sessionId) {
    console.error(
      'Error: $CLAUDE_CODE_SESSION_ID is not set.\n' +
        '`lumo session attach` must be run inside a Claude Code session.'
    )
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }

  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl
  const url = `${trimTrailingSlash(apiUrl)}/api/sessions/${encodeURIComponent(sessionId)}/bind-task`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${creds.token}`,
      },
      body: JSON.stringify({ taskIdentifier: identifier }),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
    return 1
  }

  if (res.status === 401) {
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }
  if (res.status === 404) {
    let message = 'Not found'
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      // fall through
    }
    console.error(`Error: ${message}`)
    return 1
  }
  if (!res.ok) {
    console.error(`Error: bind-task failed (HTTP ${res.status})`)
    return 1
  }

  const result = (await res.json()) as BindResponse

  writeSessionBinding(sessionId, {
    taskId: result.taskId,
    taskIdentifier: result.taskIdentifier,
    taskTitle: result.taskTitle,
    workspaceSlug: creds.workspaceSlug,
    startedAt: new Date().toISOString(),
  })

  console.log(
    `Attached session ${sessionId} to ${result.taskIdentifier} "${result.taskTitle}"`
  )
  console.log(
    `Re-tagged ${result.retaggedEventCount} previously-untagged event${
      result.retaggedEventCount === 1 ? '' : 's'
    } in this session.`
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/cli/session-attach.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add cli/src/commands/session-attach.ts __tests__/cli/session-attach.test.ts
git commit -m "feat: route session attach through bind-task with per-session file [LUM-40]"
```

---

## Task 8: Delete `session-start` command, unregister it, run migration at startup

**Files:**

- Delete: `cli/src/commands/session-start.ts`
- Modify: `cli/src/index.ts`

- [ ] **Step 1: Delete the file**

Run: `git rm cli/src/commands/session-start.ts`
Expected: file deleted, staged for commit.

- [ ] **Step 2: Update `cli/src/index.ts`**

a) Remove the `sessionStart` import. Current line 7:

```ts
import { sessionStart } from './commands/session-start'
```

Delete it.

b) Add a `migrateLegacyCurrentTask` import (group it with the other lib imports — none currently, so just add at the top after the existing command imports):

```ts
import { migrateLegacyCurrentTask } from './lib/session-binding'
```

c) Call the migration once at startup. Add right after the existing `require('../package.json')` line (around line 11), before the `wrap` helper:

```ts
migrateLegacyCurrentTask()
```

d) Remove the `session start` subcommand registration. Delete this block (currently lines ~54-59):

```ts
session
  .command('start <identifier>')
  .description(
    'Tag the next `claude code` session with a task (e.g. LUM-42). Writes ~/.lumo/current-task.json.'
  )
  .action(wrap(identifier => sessionStart(identifier as string)))
```

e) Update the `session attach` description (currently lines ~62-65) to reflect the new behavior. Replace its `.description(...)` argument with:

```ts
'Attach the currently-running Claude Code session (CLAUDE_CODE_SESSION_ID) to a task. Writes ~/.lumo/sessions/<sid>.json and re-tags untagged hook events.'
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Smoke-test the CLI manually**

Run: `cd cli && npm run build && cd ..`
Then: `node cli/dist/index.js --help`
Expected: help output lists `session attach` but NOT `session start`.

Run: `node cli/dist/index.js session start LUM-42`
Expected: stderr error `error: unknown command 'start'` (Commander's default), exit code non-zero.

- [ ] **Step 5: Commit**

```bash
git add cli/src/index.ts cli/src/commands/session-start.ts
git commit -m "feat: remove session start command, run legacy migration at startup [LUM-40]"
```

---

## Task 9: Delete `/api/sessions/attach` endpoint, `attachToTask` service, `findMostRecentForMember` repo method

**Files:**

- Delete: `app/api/sessions/attach/route.ts`
- Modify: `lib/services/session.service.ts` (remove `attachToTask` + interfaces)
- Modify: `lib/repositories/session.repository.ts` (remove `findMostRecentForMember`)

- [ ] **Step 1: Verify nothing else still uses these symbols**

Run:

```bash
grep -rn "attachToTask\|findMostRecentForMember\|/api/sessions/attach" \
  --include="*.ts" --include="*.tsx" . \
  | grep -v node_modules | grep -v ".next/" | grep -v "dist/" \
  | grep -v ".claude/worktrees" | grep -v "docs/"
```

Expected output (and ONLY this): references inside `app/api/sessions/attach/route.ts`, `lib/services/session.service.ts`, `lib/repositories/session.repository.ts`. If any other file (e.g. a forgotten test, a different route) appears, stop and re-evaluate the deletion plan.

- [ ] **Step 2: Delete the route**

Run: `git rm app/api/sessions/attach/route.ts`

- [ ] **Step 3: Remove `attachToTask` and its interfaces from the service**

In `lib/services/session.service.ts`:

a) Delete the `AttachToTaskInput` and `AttachToTaskResult` interface declarations (around lines 7-18).

b) Delete the entire `attachToTask` method block from the `sessionService` object (around lines 33-93 — the whole method including its JSDoc, ending just before `async bindSessionToTask`).

- [ ] **Step 4: Remove `findMostRecentForMember` from the repository**

In `lib/repositories/session.repository.ts`:

Delete the `findMostRecentForMember` method (around line 57). If there's a multi-line JSDoc immediately above it, delete that too.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (The `bind-task` route is untouched; the CLI no longer calls `attach`.)

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: all tests pass — there is no test for `attachToTask` (verified during planning).

- [ ] **Step 7: Commit**

```bash
git add app/api/sessions/attach/route.ts lib/services/session.service.ts lib/repositories/session.repository.ts
git commit -m "chore: remove deprecated /api/sessions/attach and attachToTask [LUM-40]"
```

---

## Task 10: Update `.claude/skills/lumo/SKILL.md`

**Files:**

- Modify: `.claude/skills/lumo/SKILL.md`

- [ ] **Step 1: Open the file and locate `## Session Management`**

Read the section. It currently documents two subcommands: `lumo session attach <identifier>` (used inside an active CC session) and `lumo session start <identifier>` (pre-tag the next session).

- [ ] **Step 2: Replace the `## Session Management` section with the new content**

Replace from `## Session Management` to (but not including) `## Workflow Example` with:

````markdown
## Session Management

### `lumo session attach <identifier>` — bind the current session to a task

Use this whenever the user mentions a task ID. The command is the only way to bind a session to a task.

```bash
lumo session attach LUM-42
```
````

What it does:

- Reads `CLAUDE_CODE_SESSION_ID` from the environment (Claude Code sets this automatically). If it is not set, the command errors out — it must run from inside a Claude Code session.
- Calls `POST /api/sessions/<session_id>/bind-task` on the Lumo server, which sets the Session row's `taskId` and re-tags previously-untagged HookEvent rows in this session.
- Writes a per-session sentinel file at `~/.lumo/sessions/<session_id>.json`. All subsequent hook events in this session pick up the new `task_id`.

**After attaching, always run `lumo task context <identifier>` to load the task background.**

### Parallel sessions

Each Claude Code session has its own `CLAUDE_CODE_SESSION_ID` and its own per-session sentinel file. Two terminals running `claude code` and binding to different tasks will not interfere with each other.

### When to suggest session binding

- If the user mentions a task ID (e.g., "let's work on LUM-42") and no session is currently bound, **suggest running `lumo session attach`**.
- If the user switches tasks mid-session, run `attach` with the new task ID — this rewrites the per-session sentinel and updates the server's Session row.

````

- [ ] **Step 3: Verify no stale references to `session start` remain**

Run: `grep -n "session start" .claude/skills/lumo/SKILL.md`
Expected: no matches (or only matches inside the unchanged Workflow Example numbered list, which references `session attach`). If `session start` still appears anywhere, edit those occurrences too.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/lumo/SKILL.md
git commit -m "docs: update lumo skill for per-session attach-only flow [LUM-40]"
````

---

## Task 11: Delete `current-task.ts` and its test

**Files:**

- Delete: `cli/src/lib/current-task.ts`
- Delete: `__tests__/cli/current-task.test.ts`

- [ ] **Step 1: Confirm nothing imports `current-task` any more**

Run:

```bash
grep -rn "from.*current-task\|require.*current-task" \
  --include="*.ts" --include="*.tsx" . \
  | grep -v node_modules | grep -v dist | grep -v ".claude/worktrees"
```

Expected: zero matches outside `current-task.ts` itself. If anything still imports it, fix that file first before deleting.

- [ ] **Step 2: Delete the files**

Run:

```bash
git rm cli/src/lib/current-task.ts __tests__/cli/current-task.test.ts
```

- [ ] **Step 3: Type-check and test**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: remove legacy current-task module [LUM-40]"
```

---

## Task 12: End-to-end manual verification

This is a manual smoke test, not a code change. Skip if running unattended.

- [ ] **Step 1: Rebuild and relink the CLI**

```bash
cd cli && npm run build && cd ..
```

(The CLI is already `npm link`ed during dev setup — the rebuilt `dist/` is picked up automatically.)

- [ ] **Step 2: Verify legacy file migration**

Manually create a stale `~/.lumo/current-task.json`:

```bash
echo '{"taskId":"x","taskIdentifier":"X","taskTitle":"x","workspaceSlug":"x","startedAt":"x"}' > ~/.lumo/current-task.json
ls -la ~/.lumo/current-task.json
```

Then run any lumo command:

```bash
lumo whoami
ls -la ~/.lumo/current-task.json 2>&1 || echo "REMOVED"
```

Expected: `REMOVED` (the migration ran on startup and deleted the file).

- [ ] **Step 3: Verify `session attach` outside Claude Code fails cleanly**

In a regular terminal (without `CLAUDE_CODE_SESSION_ID`):

```bash
lumo session attach LUM-40
```

Expected: stderr `Error: $CLAUDE_CODE_SESSION_ID is not set. ...`, exit code 1, no file written under `~/.lumo/sessions/`.

- [ ] **Step 4: Verify parallel sessions stay isolated**

In Terminal A, run `claude code`, and inside it execute (via a Bash tool call):

```
lumo session attach LUM-40 && ls ~/.lumo/sessions/
```

Note the file name (it will be `<TERMINAL_A_SESSION_ID>.json`).

In Terminal B, simultaneously run a separate `claude code` instance, and inside it:

```
lumo session attach LUM-41 && ls ~/.lumo/sessions/
```

Expected: TWO files in `~/.lumo/sessions/`, one per session, with different `taskIdentifier` contents.

Now in Terminal A, switch task:

```
lumo session attach LUM-42 && cat ~/.lumo/sessions/<TERMINAL_A_SESSION_ID>.json
```

Expected: Terminal A's file now contains `LUM-42`. Terminal B's file is **unchanged** (still LUM-41).

- [ ] **Step 5: Verify hook events tag correctly**

In each terminal, ask the agent to run a trivial command. Then open the Lumo UI timeline for LUM-40 and LUM-41 (and LUM-42 for the post-switch events). Confirm each task's timeline shows only events from the corresponding session.

---

## Self-Review (done while writing — informational)

- **Spec coverage:** every "In Scope" item in §2.1 of the spec maps to a task above (#1 → server return value; #2, #3, #4 → session-binding module; #5 → hook-runner inject; #6 → CLI session-start removal + migration startup; #7 → bindSessionToTask return; #8 → tests; #9 → SKILL.md). #7 of the spec is implemented in Task 1, #4 of the spec in Task 8.
- **Placeholders:** none. Every step has either exact code, exact commands, or exact file diffs.
- **Type consistency:** `SessionBinding` interface shape matches between session-binding.ts (Task 2) and writeSessionBinding callers (Tasks 5/7). `injectTaskId(body, hookType, sessionId)` signature is consistent across Tasks 5 and 6 (the latter adds side effects in `runHook` without changing the function signature). `BindResponse` in session-attach.ts (Task 7) matches `BindSessionToTaskResult` in session.service.ts (Task 1).
- **Ordering:** old module (`current-task.ts`) remains importable until Task 11. After Task 5, hook-runner no longer imports it; after Task 8, session-start.ts is gone; after Task 9, server-side equivalents are gone; Task 11 finally deletes the legacy module. This keeps every commit type-clean.
