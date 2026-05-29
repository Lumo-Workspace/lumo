# Memory CLI + Skill Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `lumo memory` CLI surface (over the existing LUM-70 API) plus agent-facing guidance in `SKILL.md` and CLI help/tips, so agents can record/list/promote/delete memories from the terminal with built-in worthiness judgment.

**Architecture:** Thin CLI client over the merged LUM-70 memory API. Scope-bound `task/project memory list|add` (identifier optional → defaults to the session-bound task), singleton `memory promote|rm`. Per-category field flags assemble `{category, content}` validated client-side then server-side. No backend changes. Guidance (distilled from layer1/layer2 prompts) is shared verbatim across SKILL.md, `--help`, and post-action tips.

**Tech Stack:** TypeScript CLI (commander), `cli/src/commands/` + `cli/src/lib/`, root Jest (`__tests__/cli/`), `.claude/skills/lumo/SKILL.md`.

**Spec:** `docs/superpowers/specs/2026-05-29-memory-cli-skill-design.md`

**Branch:** `lumo/LUM-70-memory-management-ui` (worktree `.worktrees/LUM-70-memory-management-ui`) — extends PR #174.

> ⚠️ **Worktree hygiene:** run all commands from the worktree; before any `tsc`, run `npx prisma generate` (shared-client race). Never `git checkout/switch/reset/stash`. Confirm branch with `git -C <worktree> branch --show-current` before committing.

---

## File Structure

**New CLI lib helpers** (`cli/src/lib/`)
- `memory-content.ts` — category/field metadata, `buildMemoryContent(category, flags)` (validate + assemble), `formatMemoryList(rows)` (id-first fixed-width rows). Pure, no I/O.
- `resolve-bound-task.ts` — `resolveBoundTaskIdentifier(base, token)`: reads `$CLAUDE_CODE_SESSION_ID`, GETs `/api/sessions/<id>`, returns `taskIdentifier | null`.

**New CLI command files** (`cli/src/commands/`)
- `memory-task-list.ts`, `memory-task-add.ts`, `memory-project-list.ts`, `memory-project-add.ts`, `memory-promote.ts`, `memory-rm.ts`

**Modified**
- `cli/src/index.ts` — register `task memory`, `project memory`, top-level `memory`.
- `.claude/skills/lumo/SKILL.md` — `## Memory management` section + frontmatter triggers.
- `cli/package.json` — version `1.4.0` → `1.5.0`.

**Tests** (`__tests__/cli/`)
- `memory-content.test.ts`, `resolve-bound-task.test.ts`, `memory-add-action.test.ts`, `memory-promote-action.test.ts`

---

## Shared reference: existing patterns to mirror (read once)

- **Command file shape:** `cli/src/commands/task-artifact-add.ts` (creds → apiUrl → validate → fetch → status handling → stdout).
- **Resolve LUM-N → task id:** `GET /api/tasks/resolve/<identifier>` → `{ id, identifier, title, status }` (see `cli/src/commands/task-comment.ts`).
- **Resolve project ref → id:** `GET /api/projects` → `{ projects: [{ id, name }] }`; match `slugify(name) === ref` or `name.toLowerCase() === ref.toLowerCase()`. `slugify` is exported from `cli/src/lib/resolve`.
- **Resolve bound task's project:** `GET /api/tasks/by-identifier/<identifier>` → `{ task: { …, project: { id, name } } }`.
- **creds + base URL boilerplate** (identical in every command):
  ```ts
  const creds = readCredentials()
  if (!creds) { console.error('Error: not logged in. Run `lumo auth login` first.'); return 1 }
  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl
  const base = trimTrailingSlash(apiUrl)
  ```
- **commander registration:** nested group via `const grp = parent.command('memory'); grp.command('add ...').action(wrap(...))`. `wrap` catches throws → exit 1.

---

## Task 1: `memory-content.ts` pure helpers (build + format)

**Files:**
- Create: `cli/src/lib/memory-content.ts`
- Test: `__tests__/cli/memory-content.test.ts`

- [ ] **Step 1: Confirm branch** — `git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-70-memory-management-ui branch --show-current` → `lumo/LUM-70-memory-management-ui`.

- [ ] **Step 2: Write the failing test** — `__tests__/cli/memory-content.test.ts`:
```ts
/** @jest-environment node */
import { buildMemoryContent, formatMemoryList } from '@/cli/src/lib/memory-content'

describe('buildMemoryContent', () => {
  it('builds a TRAP, trimming and dropping empty workaround', () => {
    const r = buildMemoryContent('trap', { trigger: ' t ', outcome: ' o ', workaround: '  ' })
    expect(r).toEqual({ ok: true, category: 'TRAP', content: { trigger: 't', outcome: 'o' } })
  })
  it('keeps a non-empty TRAP workaround', () => {
    const r = buildMemoryContent('trap', { trigger: 't', outcome: 'o', workaround: 'w' })
    expect(r).toEqual({ ok: true, category: 'TRAP', content: { trigger: 't', outcome: 'o', workaround: 'w' } })
  })
  it('errors on a missing required TRAP field', () => {
    const r = buildMemoryContent('trap', { trigger: 't' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/outcome/)
  })
  it('builds a DECISION dropping empty optionals', () => {
    const r = buildMemoryContent('decision', { what: 'a', why: 'b', alternatives: '', implications: '' })
    expect(r).toEqual({ ok: true, category: 'DECISION', content: { what: 'a', why: 'b' } })
  })
  it('maps --applies to convention content.scope', () => {
    const r = buildMemoryContent('convention', { rule: 'r', applies: 'everywhere' })
    expect(r).toEqual({ ok: true, category: 'CONVENTION', content: { rule: 'r', scope: 'everywhere' } })
  })
  it('errors when convention --applies is missing', () => {
    const r = buildMemoryContent('convention', { rule: 'r' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/applies/)
  })
  it('builds a PROCEDURAL with repeated --step, trimming/filtering empties', () => {
    const r = buildMemoryContent('procedural', { workflow: 'w', trigger: 't', step: [' s1 ', '  ', 's2'] })
    expect(r).toEqual({ ok: true, category: 'PROCEDURAL', content: { workflow: 'w', trigger: 't', steps: ['s1', 's2'] } })
  })
  it('omits steps when none non-empty', () => {
    const r = buildMemoryContent('procedural', { workflow: 'w', trigger: 't', step: ['', ' '] })
    expect(r).toEqual({ ok: true, category: 'PROCEDURAL', content: { workflow: 'w', trigger: 't' } })
  })
  it('errors on an unknown category', () => {
    const r = buildMemoryContent('nope', { trigger: 't', outcome: 'o' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/category/i)
  })
})

describe('formatMemoryList', () => {
  const rows = [
    { id: 'cmd_x', scope: 'TASK', category: 'TRAP', content: { trigger: 'enum mid-migration fails', outcome: 'P3009' }, createdByMemberId: null },
    { id: 'cmd_y', scope: 'PROJECT', category: 'CONVENTION', content: { rule: 'use Zod', scope: 'all' }, createdByMemberId: 'm1' },
  ]
  it('renders id-first rows with auto/manual source and a headline', () => {
    const out = formatMemoryList(rows as any)
    expect(out).toMatch(/cmd_x\s+TASK\s+TRAP\s+enum mid-migration fails\s+auto/)
    expect(out).toMatch(/cmd_y\s+PROJECT\s+CONVENTION\s+use Zod\s+manual/)
  })
  it('handles an empty list', () => {
    expect(formatMemoryList([])).toBe('No memories.')
  })
})
```

- [ ] **Step 3: Run → fail** — `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-70-memory-management-ui && npx jest memory-content` → FAIL (module missing).

- [ ] **Step 4: Implement `cli/src/lib/memory-content.ts`:**
```ts
// Category/field metadata + builders for the `lumo memory` commands.
// Mirrors the four content shapes validated server-side by parseMemoryContent.

export type CategoryInput = 'trap' | 'decision' | 'convention' | 'procedural'
type Built =
  | { ok: true; category: 'TRAP' | 'DECISION' | 'CONVENTION' | 'PROCEDURAL'; content: Record<string, unknown> }
  | { ok: false; error: string }

export interface MemoryFlags {
  trigger?: string
  outcome?: string
  workaround?: string
  what?: string
  why?: string
  alternatives?: string
  implications?: string
  rule?: string
  applies?: string
  workflow?: string
  step?: string[]
}

const trimmed = (v?: string) => (v ?? '').trim()

/**
 * Validate the per-category flags and assemble { category, content }. Required
 * fields must be non-empty; optional string fields are dropped when blank;
 * `--applies` maps to convention `content.scope`; repeated `--step` becomes a
 * trimmed, empty-filtered `steps` array (omitted when empty).
 */
export function buildMemoryContent(category: string, flags: MemoryFlags): Built {
  const cat = category?.toLowerCase()
  switch (cat) {
    case 'trap': {
      const trigger = trimmed(flags.trigger)
      const outcome = trimmed(flags.outcome)
      const workaround = trimmed(flags.workaround)
      if (!trigger) return { ok: false, error: '--trigger is required for category trap.' }
      if (!outcome) return { ok: false, error: '--outcome is required for category trap.' }
      return { ok: true, category: 'TRAP', content: { trigger, outcome, ...(workaround ? { workaround } : {}) } }
    }
    case 'decision': {
      const what = trimmed(flags.what)
      const why = trimmed(flags.why)
      const alternatives = trimmed(flags.alternatives)
      const implications = trimmed(flags.implications)
      if (!what) return { ok: false, error: '--what is required for category decision.' }
      if (!why) return { ok: false, error: '--why is required for category decision.' }
      return {
        ok: true,
        category: 'DECISION',
        content: { what, why, ...(alternatives ? { alternatives } : {}), ...(implications ? { implications } : {}) },
      }
    }
    case 'convention': {
      const rule = trimmed(flags.rule)
      const applies = trimmed(flags.applies)
      if (!rule) return { ok: false, error: '--rule is required for category convention.' }
      if (!applies) return { ok: false, error: '--applies is required for category convention (where the rule applies).' }
      return { ok: true, category: 'CONVENTION', content: { rule, scope: applies } }
    }
    case 'procedural': {
      const workflow = trimmed(flags.workflow)
      const trigger = trimmed(flags.trigger)
      const steps = (flags.step ?? []).map(s => s.trim()).filter(Boolean)
      if (!workflow) return { ok: false, error: '--workflow is required for category procedural.' }
      if (!trigger) return { ok: false, error: '--trigger is required for category procedural.' }
      return { ok: true, category: 'PROCEDURAL', content: { workflow, trigger, ...(steps.length ? { steps } : {}) } }
    }
    default:
      return { ok: false, error: `Unknown --category "${category}". Use trap | decision | convention | procedural.` }
  }
}

export interface MemoryRowLike {
  id: string
  scope: string
  category: string
  content: unknown
  createdByMemberId: string | null
}

function headline(category: string, content: unknown): string {
  const c = (content ?? {}) as Record<string, unknown>
  const key =
    category === 'TRAP' ? 'trigger'
    : category === 'DECISION' ? 'what'
    : category === 'CONVENTION' ? 'rule'
    : 'workflow'
  const v = c[key]
  return typeof v === 'string' && v.length > 0 ? v : '(unparseable)'
}

/** Fixed-width rows: id  SCOPE  CATEGORY  headline  source(auto|manual). */
export function formatMemoryList(rows: MemoryRowLike[]): string {
  if (rows.length === 0) return 'No memories.'
  const idW = Math.max(...rows.map(r => r.id.length))
  const scopeW = Math.max(...rows.map(r => r.scope.length))
  const catW = Math.max(...rows.map(r => r.category.length))
  return rows
    .map(r => {
      const src = r.createdByMemberId ? 'manual' : 'auto'
      return `${r.id.padEnd(idW)}  ${r.scope.padEnd(scopeW)}  ${r.category.padEnd(catW)}  ${headline(r.category, r.content)}  ${src}`
    })
    .join('\n')
}
```

- [ ] **Step 5: Run → pass** — `npx jest memory-content` → PASS.

- [ ] **Step 6: Commit**
```bash
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-70-memory-management-ui add cli/src/lib/memory-content.ts __tests__/cli/memory-content.test.ts
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-70-memory-management-ui commit -m "feat(cli): memory content builder + list formatter [LUM-70]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `resolve-bound-task.ts` helper

**Files:**
- Create: `cli/src/lib/resolve-bound-task.ts`
- Test: `__tests__/cli/resolve-bound-task.test.ts`

- [ ] **Step 1: Write the failing test** — `__tests__/cli/resolve-bound-task.test.ts`:
```ts
/** @jest-environment node */
import { resolveBoundTaskIdentifier } from '@/cli/src/lib/resolve-bound-task'

const OLD_ENV = process.env
beforeEach(() => { process.env = { ...OLD_ENV } })
afterEach(() => { process.env = OLD_ENV; jest.restoreAllMocks() })

it('returns null when CLAUDE_CODE_SESSION_ID is unset', async () => {
  delete process.env.CLAUDE_CODE_SESSION_ID
  const r = await resolveBoundTaskIdentifier('https://x', 'tok')
  expect(r).toBeNull()
})

it('returns the bound taskIdentifier', async () => {
  process.env.CLAUDE_CODE_SESSION_ID = 'sess1'
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({ taskIdentifier: 'LUM-42', taskTitle: 'T' }),
  } as Response)
  const r = await resolveBoundTaskIdentifier('https://x', 'tok')
  expect(r).toBe('LUM-42')
})

it('returns null when the session has no bound task (404 or null identifier)', async () => {
  process.env.CLAUDE_CODE_SESSION_ID = 'sess1'
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true, status: 200, json: async () => ({ taskIdentifier: null }),
  } as Response)
  expect(await resolveBoundTaskIdentifier('https://x', 'tok')).toBeNull()
})

it('returns null on a 404 session', async () => {
  process.env.CLAUDE_CODE_SESSION_ID = 'sess1'
  jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 404 } as Response)
  expect(await resolveBoundTaskIdentifier('https://x', 'tok')).toBeNull()
})
```

- [ ] **Step 2: Run → fail** — `npx jest resolve-bound-task` → FAIL.

- [ ] **Step 3: Implement `cli/src/lib/resolve-bound-task.ts`:**
```ts
import { trimTrailingSlash } from './api'

/**
 * The task identifier (LUM-N) the current Claude Code session is bound to, or
 * null when there is no session env, no server-side session row, or no binding.
 * Used by the memory commands to default their target to the bound task.
 */
export async function resolveBoundTaskIdentifier(
  apiUrl: string,
  token: string
): Promise<string | null> {
  const sessionId = process.env.CLAUDE_CODE_SESSION_ID
  if (!sessionId) return null
  const url = `${trimTrailingSlash(apiUrl)}/api/sessions/${encodeURIComponent(sessionId)}`
  let res: Response
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  } catch {
    return null
  }
  if (!res.ok) return null
  try {
    const data = (await res.json()) as { taskIdentifier?: string | null }
    return data.taskIdentifier ?? null
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run → pass** — `npx jest resolve-bound-task` → PASS.

- [ ] **Step 5: Commit**
```bash
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-70-memory-management-ui add cli/src/lib/resolve-bound-task.ts __tests__/cli/resolve-bound-task.test.ts
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-70-memory-management-ui commit -m "feat(cli): resolve session-bound task identifier [LUM-70]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `task memory list` + `add` commands

**Files:**
- Create: `cli/src/commands/memory-task-list.ts`, `cli/src/commands/memory-task-add.ts`
- Modify: `cli/src/index.ts`
- Test: `__tests__/cli/memory-add-action.test.ts`

A small shared resolver is used by both task commands. To avoid duplicating the resolve+creds boilerplate across all four scope-bound commands, put a helper in `memory-task-add.ts`? No — keep it inline per the repo's per-command style (task-comment inlines). Both commands inline: creds → base → resolve target → fetch.

- [ ] **Step 1: Implement `cli/src/commands/memory-task-add.ts`:**
```ts
import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'
import { buildMemoryContent, type MemoryFlags } from '../lib/memory-content'
import { resolveBoundTaskIdentifier } from '../lib/resolve-bound-task'

interface AddOptions extends MemoryFlags {
  category?: string
}

export async function memoryTaskAdd(
  identifierArg: string | undefined,
  options: AddOptions
): Promise<number | void> {
  if (!options.category) {
    console.error('Error: --category <trap|decision|convention|procedural> is required.')
    return 1
  }
  const built = buildMemoryContent(options.category, options)
  if (!built.ok) {
    console.error(`Error: ${built.error}`)
    return 1
  }

  const creds = readCredentials()
  if (!creds) { console.error('Error: not logged in. Run `lumo auth login` first.'); return 1 }
  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl
  const base = trimTrailingSlash(apiUrl)

  // Resolve the target: explicit arg > session-bound task.
  const identifier = identifierArg ?? (await resolveBoundTaskIdentifier(apiUrl, creds.token))
  if (!identifier) {
    console.error(
      'Error: no <LUM-N> given and no task bound to this session.\n' +
        'Pass it explicitly or run `lumo session attach <LUM-N>`.'
    )
    return 1
  }

  // LUM-N → task id.
  let taskId: string
  try {
    const r = await fetch(`${base}/api/tasks/resolve/${encodeURIComponent(identifier)}`, {
      headers: { Authorization: `Bearer ${creds.token}` },
    })
    if (r.status === 401) { console.error('Error: API key invalid or revoked. Run `lumo auth login`.'); return 1 }
    if (r.status === 404) { console.error(`Error: task ${identifier} not found in workspace ${creds.workspaceSlug}`); return 1 }
    if (!r.ok) { console.error(`Error: resolve failed (HTTP ${r.status})`); return 1 }
    taskId = ((await r.json()) as { id: string }).id
  } catch (err) {
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${err instanceof Error ? err.message : String(err)})`)
    return 1
  }

  // POST the memory.
  let res: Response
  try {
    res = await fetch(`${base}/api/tasks/${encodeURIComponent(taskId)}/memories`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: built.category, content: built.content }),
    })
  } catch (err) {
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${err instanceof Error ? err.message : String(err)})`)
    return 1
  }
  if (res.status !== 201) {
    let m: string | null = null
    try { const b = (await res.json()) as { error?: string }; if (typeof b.error === 'string') m = b.error } catch { /* */ }
    console.error(m ? `Error: ${m}` : `Error: memory add failed (HTTP ${res.status})`)
    return 1
  }

  process.stdout.write(
    `Added ${built.category} memory to ${identifier}` +
      `${identifierArg ? '' : ' (from bound session)'}\n` +
      'Tip: only useful for this task? If it generalizes, use `lumo project memory add` or `lumo memory promote` later.\n'
  )
}
```

- [ ] **Step 2: Implement `cli/src/commands/memory-task-list.ts`:**
```ts
import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'
import { formatMemoryList, type MemoryRowLike } from '../lib/memory-content'
import { resolveBoundTaskIdentifier } from '../lib/resolve-bound-task'

interface ListOptions {
  category?: string
  limit?: string
}

export async function memoryTaskList(
  identifierArg: string | undefined,
  options: ListOptions
): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) { console.error('Error: not logged in. Run `lumo auth login` first.'); return 1 }
  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl
  const base = trimTrailingSlash(apiUrl)

  const identifier = identifierArg ?? (await resolveBoundTaskIdentifier(apiUrl, creds.token))
  if (!identifier) {
    console.error('Error: no <LUM-N> given and no task bound to this session.\nPass it explicitly or run `lumo session attach <LUM-N>`.')
    return 1
  }

  let taskId: string
  try {
    const r = await fetch(`${base}/api/tasks/resolve/${encodeURIComponent(identifier)}`, { headers: { Authorization: `Bearer ${creds.token}` } })
    if (r.status === 404) { console.error(`Error: task ${identifier} not found in workspace ${creds.workspaceSlug}`); return 1 }
    if (!r.ok) { console.error(`Error: resolve failed (HTTP ${r.status})`); return 1 }
    taskId = ((await r.json()) as { id: string }).id
  } catch (err) {
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${err instanceof Error ? err.message : String(err)})`)
    return 1
  }

  let res: Response
  try {
    res = await fetch(`${base}/api/tasks/${encodeURIComponent(taskId)}/memories`, { headers: { Authorization: `Bearer ${creds.token}` } })
  } catch (err) {
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${err instanceof Error ? err.message : String(err)})`)
    return 1
  }
  if (!res.ok) { console.error(`Error: memory list failed (HTTP ${res.status})`); return 1 }

  let rows = ((await res.json()) as { memories: MemoryRowLike[] }).memories
  if (options.category) rows = rows.filter(m => m.category.toLowerCase() === options.category!.toLowerCase())
  const limit = options.limit ? parseInt(options.limit, 10) : undefined
  if (limit && limit > 0) rows = rows.slice(0, limit)
  process.stdout.write(formatMemoryList(rows) + '\n')
}
```

- [ ] **Step 3: Register in `cli/src/index.ts`** — add imports near the other command imports:
```ts
import { memoryTaskList } from './commands/memory-task-list'
import { memoryTaskAdd } from './commands/memory-task-add'
```
Then, after the `taskArtifact` group block, add a `task memory` group (the `task` variable is the existing `program.command('task')`):
```ts
const taskMemory = task
  .command('memory')
  .description('View and record memories scoped to a task')

taskMemory
  .command('list [task]')
  .description('List a task\'s memories. <task> defaults to the session-bound task.')
  .option('--category <cat>', 'Filter by trap|decision|convention|procedural')
  .option('-n, --limit <count>', 'Cap output to the first N rows')
  .action(wrap((taskArg: unknown, opts: unknown) => memoryTaskList(taskArg as string | undefined, opts as Record<string, string>)))

taskMemory
  .command('add [task]')
  .description(
    'Record a memory on a task (<task> defaults to the bound session). ' +
      'Record only knowledge invisible in the codebase (the why, a runtime gotcha, a non-obvious failure, a non-trivial workflow); skip routine work. ' +
      'Pick --category then its fields.'
  )
  .requiredOption('--category <cat>', 'trap | decision | convention | procedural')
  .option('--trigger <text>', 'trap/procedural: the situation that triggers it')
  .option('--outcome <text>', 'trap: what goes wrong')
  .option('--workaround <text>', 'trap: optional fix')
  .option('--what <text>', 'decision: the decision')
  .option('--why <text>', 'decision: rationale')
  .option('--alternatives <text>', 'decision: optional alternatives considered')
  .option('--implications <text>', 'decision: optional implications')
  .option('--rule <text>', 'convention: the rule')
  .option('--applies <text>', 'convention: where the rule applies')
  .option('--workflow <text>', 'procedural: the workflow name')
  .option('--step <text>', 'procedural: a step (repeatable)', (v: string, acc: string[]) => { acc.push(v); return acc }, [] as string[])
  .action(wrap((taskArg: unknown, opts: unknown) => memoryTaskAdd(taskArg as string | undefined, opts as Record<string, unknown>)))
```

- [ ] **Step 4: Write the failing action test** — `__tests__/cli/memory-add-action.test.ts`:
```ts
/** @jest-environment node */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: () => ({ token: 'tok', apiUrl: 'https://x', workspaceSlug: 'ws' }),
}))

import { memoryTaskAdd } from '@/cli/src/commands/memory-task-add'

afterEach(() => { jest.restoreAllMocks(); delete process.env.CLAUDE_CODE_SESSION_ID })

function mockFetchSequence(handlers: Array<(url: string, init?: any) => Partial<Response> & { json?: () => Promise<any> }>) {
  let i = 0
  jest.spyOn(global, 'fetch').mockImplementation(((url: any, init: any) => {
    const h = handlers[i++]
    return Promise.resolve(h(String(url), init) as Response)
  }) as any)
}

it('rejects a missing required field before any network call', async () => {
  const fetchSpy = jest.spyOn(global, 'fetch')
  const err = jest.spyOn(console, 'error').mockImplementation(() => {})
  const code = await memoryTaskAdd('LUM-1', { category: 'trap', trigger: 'only trigger' } as any)
  expect(code).toBe(1)
  expect(fetchSpy).not.toHaveBeenCalled()
  expect(err).toHaveBeenCalledWith(expect.stringMatching(/outcome/))
})

it('resolves LUM-N then POSTs the assembled content (201)', async () => {
  const out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  const calls: Array<{ url: string; init?: any }> = []
  mockFetchSequence([
    (url) => { calls.push({ url }); return { ok: true, status: 200, json: async () => ({ id: 'task_cuid' }) } },
    (url, init) => { calls.push({ url, init }); return { ok: true, status: 201, json: async () => ({ memory: { id: 'mem1' } }) } },
  ])
  const code = await memoryTaskAdd('LUM-1', { category: 'trap', trigger: 't', outcome: 'o' } as any)
  expect(code).toBeUndefined()
  expect(calls[0].url).toContain('/api/tasks/resolve/LUM-1')
  expect(calls[1].url).toContain('/api/tasks/task_cuid/memories')
  expect(JSON.parse(calls[1].init.body)).toEqual({ category: 'TRAP', content: { trigger: 't', outcome: 'o' } })
  expect(out).toHaveBeenCalledWith(expect.stringMatching(/Added TRAP memory to LUM-1/))
})

it('falls back to the session-bound task when <task> is omitted', async () => {
  process.env.CLAUDE_CODE_SESSION_ID = 'sess1'
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  const calls: string[] = []
  mockFetchSequence([
    (url) => { calls.push(url); return { ok: true, status: 200, json: async () => ({ taskIdentifier: 'LUM-9' }) } }, // session
    (url) => { calls.push(url); return { ok: true, status: 200, json: async () => ({ id: 'task9' }) } }, // resolve
    (url) => { calls.push(url); return { ok: true, status: 201, json: async () => ({ memory: { id: 'm' } }) } }, // post
  ])
  const code = await memoryTaskAdd(undefined, { category: 'trap', trigger: 't', outcome: 'o' } as any)
  expect(code).toBeUndefined()
  expect(calls[0]).toContain('/api/sessions/sess1')
  expect(calls[1]).toContain('/api/tasks/resolve/LUM-9')
})

it('errors when no <task> and no binding', async () => {
  delete process.env.CLAUDE_CODE_SESSION_ID
  const err = jest.spyOn(console, 'error').mockImplementation(() => {})
  const code = await memoryTaskAdd(undefined, { category: 'trap', trigger: 't', outcome: 'o' } as any)
  expect(code).toBe(1)
  expect(err).toHaveBeenCalledWith(expect.stringMatching(/no task bound/i))
})
```

- [ ] **Step 5: Run tests + typecheck**
```
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-70-memory-management-ui
npx prisma generate >/dev/null 2>&1
npx jest memory-add-action
npx tsc --noEmit
```
Expected: tests PASS; tsc clean. (If tsc errors only on `createdByMemberId`/`updatedAt` in `lib/repositories/memory.repository.ts` → re-run `npx prisma generate`; never edit source.)

- [ ] **Step 6: Commit**
```bash
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-70-memory-management-ui add cli/src/commands/memory-task-list.ts cli/src/commands/memory-task-add.ts cli/src/index.ts __tests__/cli/memory-add-action.test.ts
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-70-memory-management-ui commit -m "feat(cli): lumo task memory list/add [LUM-70]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `project memory list` + `add` commands

**Files:**
- Create: `cli/src/commands/memory-project-list.ts`, `cli/src/commands/memory-project-add.ts`
- Modify: `cli/src/index.ts`

Both resolve the project id: explicit `<project-ref>` via `GET /api/projects` (match `slugify(name)` or name), or — when omitted — the **bound task's project** via `GET /api/tasks/by-identifier/<boundIdentifier>` → `task.project.id`.

- [ ] **Step 1: Add a shared project resolver** `cli/src/lib/resolve-project.ts`:
```ts
import { trimTrailingSlash } from './api'
import { slugify } from './resolve'

/** Resolve a project name/slug to its id via GET /api/projects. */
export async function resolveProjectIdByRef(
  apiUrl: string, token: string, ref: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const base = trimTrailingSlash(apiUrl)
  let res: Response
  try {
    res = await fetch(`${base}/api/projects`, { headers: { Authorization: `Bearer ${token}` } })
  } catch (err) {
    return { ok: false, error: `could not reach Lumo API (${err instanceof Error ? err.message : String(err)})` }
  }
  if (!res.ok) return { ok: false, error: `project list failed (HTTP ${res.status})` }
  const { projects } = (await res.json()) as { projects: Array<{ id: string; name: string }> }
  const want = ref.toLowerCase()
  const match = projects.find(p => slugify(p.name) === ref || p.name.toLowerCase() === want)
  if (!match) return { ok: false, error: `project "${ref}" not found. Run \`lumo project list\`.` }
  return { ok: true, id: match.id }
}

/** Resolve the project id of the task bound to this session (via its identifier). */
export async function resolveBoundProjectId(
  apiUrl: string, token: string, boundIdentifier: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const base = trimTrailingSlash(apiUrl)
  let res: Response
  try {
    res = await fetch(`${base}/api/tasks/by-identifier/${encodeURIComponent(boundIdentifier)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch (err) {
    return { ok: false, error: `could not reach Lumo API (${err instanceof Error ? err.message : String(err)})` }
  }
  if (!res.ok) return { ok: false, error: `could not resolve bound task ${boundIdentifier} (HTTP ${res.status})` }
  const { task } = (await res.json()) as { task: { project?: { id?: string } } }
  const id = task.project?.id
  if (!id) return { ok: false, error: `bound task ${boundIdentifier} has no resolvable project` }
  return { ok: true, id }
}
```
> Before implementing: read `cli/src/commands/task-show.ts` (or `lib/services/task-cli.service.ts`'s `showFromCli`) to confirm the `by-identifier` response really exposes `task.project.id`. If the field is named differently (e.g. `projectId` or only `project.slug`), adjust `resolveBoundProjectId` to read the actual field — do NOT change the server.

- [ ] **Step 2: Implement `cli/src/commands/memory-project-add.ts`:**
```ts
import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'
import { buildMemoryContent, type MemoryFlags } from '../lib/memory-content'
import { resolveBoundTaskIdentifier } from '../lib/resolve-bound-task'
import { resolveProjectIdByRef, resolveBoundProjectId } from '../lib/resolve-project'

interface AddOptions extends MemoryFlags { category?: string }

export async function memoryProjectAdd(
  refArg: string | undefined,
  options: AddOptions
): Promise<number | void> {
  if (!options.category) { console.error('Error: --category <trap|decision|convention|procedural> is required.'); return 1 }
  const built = buildMemoryContent(options.category, options)
  if (!built.ok) { console.error(`Error: ${built.error}`); return 1 }

  const creds = readCredentials()
  if (!creds) { console.error('Error: not logged in. Run `lumo auth login` first.'); return 1 }
  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl
  const base = trimTrailingSlash(apiUrl)

  // Resolve project id: explicit ref > bound task's project.
  let projectId: string
  let echoSuffix = ''
  if (refArg) {
    const r = await resolveProjectIdByRef(apiUrl, creds.token, refArg)
    if (!r.ok) { console.error(`Error: ${r.error}`); return 1 }
    projectId = r.id
  } else {
    const bound = await resolveBoundTaskIdentifier(apiUrl, creds.token)
    if (!bound) { console.error('Error: no <project-ref> given and no task bound to this session.\nPass a project, or run `lumo session attach <LUM-N>`.'); return 1 }
    const r = await resolveBoundProjectId(apiUrl, creds.token, bound)
    if (!r.ok) { console.error(`Error: ${r.error}`); return 1 }
    projectId = r.id
    echoSuffix = ` (project of bound task ${bound})`
  }

  let res: Response
  try {
    res = await fetch(`${base}/api/projects/${encodeURIComponent(projectId)}/memories`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: built.category, content: built.content }),
    })
  } catch (err) {
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${err instanceof Error ? err.message : String(err)})`)
    return 1
  }
  if (res.status !== 201) {
    let m: string | null = null
    try { const b = (await res.json()) as { error?: string }; if (typeof b.error === 'string') m = b.error } catch { /* */ }
    console.error(m ? `Error: ${m}` : `Error: memory add failed (HTTP ${res.status})`)
    return 1
  }
  process.stdout.write(`Added ${built.category} PROJECT memory${echoSuffix}\n`)
}
```

- [ ] **Step 3: Implement `cli/src/commands/memory-project-list.ts`** (mirror of task list, resolving the project id):
```ts
import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'
import { formatMemoryList, type MemoryRowLike } from '../lib/memory-content'
import { resolveBoundTaskIdentifier } from '../lib/resolve-bound-task'
import { resolveProjectIdByRef, resolveBoundProjectId } from '../lib/resolve-project'

interface ListOptions { category?: string; limit?: string }

export async function memoryProjectList(
  refArg: string | undefined,
  options: ListOptions
): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) { console.error('Error: not logged in. Run `lumo auth login` first.'); return 1 }
  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl
  const base = trimTrailingSlash(apiUrl)

  let projectId: string
  if (refArg) {
    const r = await resolveProjectIdByRef(apiUrl, creds.token, refArg)
    if (!r.ok) { console.error(`Error: ${r.error}`); return 1 }
    projectId = r.id
  } else {
    const bound = await resolveBoundTaskIdentifier(apiUrl, creds.token)
    if (!bound) { console.error('Error: no <project-ref> given and no task bound to this session.\nPass a project, or run `lumo session attach <LUM-N>`.'); return 1 }
    const r = await resolveBoundProjectId(apiUrl, creds.token, bound)
    if (!r.ok) { console.error(`Error: ${r.error}`); return 1 }
    projectId = r.id
  }

  let res: Response
  try {
    res = await fetch(`${base}/api/projects/${encodeURIComponent(projectId)}/memories`, { headers: { Authorization: `Bearer ${creds.token}` } })
  } catch (err) {
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${err instanceof Error ? err.message : String(err)})`)
    return 1
  }
  if (!res.ok) { console.error(`Error: memory list failed (HTTP ${res.status})`); return 1 }

  let rows = ((await res.json()) as { memories: MemoryRowLike[] }).memories
  if (options.category) rows = rows.filter(m => m.category.toLowerCase() === options.category!.toLowerCase())
  const limit = options.limit ? parseInt(options.limit, 10) : undefined
  if (limit && limit > 0) rows = rows.slice(0, limit)
  process.stdout.write(formatMemoryList(rows) + '\n')
}
```

- [ ] **Step 4: Register in `cli/src/index.ts`** — imports:
```ts
import { memoryProjectList } from './commands/memory-project-list'
import { memoryProjectAdd } from './commands/memory-project-add'
```
After the `projectCmd` definition (the existing `program.command('project')`), add:
```ts
const projectMemory = projectCmd
  .command('memory')
  .description('View and record PROJECT-scope memories')

projectMemory
  .command('list [project]')
  .description('List a project\'s PROJECT-scope memories. <project> defaults to the bound task\'s project.')
  .option('--category <cat>', 'Filter by trap|decision|convention|procedural')
  .option('-n, --limit <count>', 'Cap output to the first N rows')
  .action(wrap((p: unknown, opts: unknown) => memoryProjectList(p as string | undefined, opts as Record<string, string>)))

projectMemory
  .command('add [project]')
  .description('Record a PROJECT-scope memory. Use PROJECT scope only when the lesson helps any task in the project. <project> defaults to the bound task\'s project.')
  .requiredOption('--category <cat>', 'trap | decision | convention | procedural')
  .option('--trigger <text>', 'trap/procedural trigger')
  .option('--outcome <text>', 'trap outcome')
  .option('--workaround <text>', 'trap optional workaround')
  .option('--what <text>', 'decision')
  .option('--why <text>', 'decision rationale')
  .option('--alternatives <text>', 'decision optional alternatives')
  .option('--implications <text>', 'decision optional implications')
  .option('--rule <text>', 'convention rule')
  .option('--applies <text>', 'convention: where it applies')
  .option('--workflow <text>', 'procedural workflow')
  .option('--step <text>', 'procedural step (repeatable)', (v: string, acc: string[]) => { acc.push(v); return acc }, [] as string[])
  .action(wrap((p: unknown, opts: unknown) => memoryProjectAdd(p as string | undefined, opts as Record<string, unknown>)))
```

- [ ] **Step 5: Typecheck** — `npx prisma generate >/dev/null 2>&1 && npx tsc --noEmit` → clean. (The `buildMemoryContent`/binding logic is already covered by Task 1/2/3 tests; project commands reuse them. The existing `memory-add-action` test covers the content + binding paths; no new action test required for the project mirror — it shares the same helpers. If you want extra coverage, add a `resolve-project` unit test mocking fetch.)

- [ ] **Step 6: Commit**
```bash
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-70-memory-management-ui add cli/src/lib/resolve-project.ts cli/src/commands/memory-project-list.ts cli/src/commands/memory-project-add.ts cli/src/index.ts
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-70-memory-management-ui commit -m "feat(cli): lumo project memory list/add [LUM-70]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `memory promote` + `memory rm` commands

**Files:**
- Create: `cli/src/commands/memory-promote.ts`, `cli/src/commands/memory-rm.ts`
- Modify: `cli/src/index.ts`
- Test: `__tests__/cli/memory-promote-action.test.ts`

- [ ] **Step 1: Implement `cli/src/commands/memory-promote.ts`:**
```ts
import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'

export async function memoryPromote(memoryId: string | undefined): Promise<number | void> {
  if (!memoryId) { console.error('Error: missing <memoryId>. Usage: lumo memory promote <memoryId>'); return 1 }
  const creds = readCredentials()
  if (!creds) { console.error('Error: not logged in. Run `lumo auth login` first.'); return 1 }
  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl
  const base = trimTrailingSlash(apiUrl)

  let res: Response
  try {
    res = await fetch(`${base}/api/memories/${encodeURIComponent(memoryId)}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'PROJECT' }),
    })
  } catch (err) {
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${err instanceof Error ? err.message : String(err)})`)
    return 1
  }
  if (res.status === 404) { console.error(`Error: memory ${memoryId} not found`); return 1 }
  if (res.status === 409) { console.error('Error: this memory is already project-scoped.'); return 1 }
  if (res.status !== 200) {
    let m: string | null = null
    try { const b = (await res.json()) as { error?: string }; if (typeof b.error === 'string') m = b.error } catch { /* */ }
    console.error(m ? `Error: ${m}` : `Error: promote failed (HTTP ${res.status})`)
    return 1
  }
  process.stdout.write(
    `Promoted ${memoryId} to PROJECT — every agent on this project now sees it.\n` +
      'Promote only lessons that recur across 2+ tasks.\n'
  )
}
```

- [ ] **Step 2: Implement `cli/src/commands/memory-rm.ts`:**
```ts
import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'

interface RmOptions { yes?: boolean }

export async function memoryRm(memoryId: string | undefined, options: RmOptions): Promise<number | void> {
  if (!memoryId) { console.error('Error: missing <memoryId>. Usage: lumo memory rm <memoryId> --yes'); return 1 }
  if (!options.yes) { console.error('Error: refusing to delete without --yes. Re-run with --yes to confirm.'); return 1 }
  const creds = readCredentials()
  if (!creds) { console.error('Error: not logged in. Run `lumo auth login` first.'); return 1 }
  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl
  const base = trimTrailingSlash(apiUrl)

  let res: Response
  try {
    res = await fetch(`${base}/api/memories/${encodeURIComponent(memoryId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${creds.token}` },
    })
  } catch (err) {
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${err instanceof Error ? err.message : String(err)})`)
    return 1
  }
  if (res.status === 404) { console.error(`Error: memory ${memoryId} not found`); return 1 }
  if (res.status !== 204) { console.error(`Error: delete failed (HTTP ${res.status})`); return 1 }
  process.stdout.write(`Deleted memory ${memoryId}\n`)
}
```

- [ ] **Step 3: Register in `cli/src/index.ts`** — imports:
```ts
import { memoryPromote } from './commands/memory-promote'
import { memoryRm } from './commands/memory-rm'
```
Add a top-level `memory` group (near the other top-level `program.command(...)` definitions):
```ts
const memoryCmd = program
  .command('memory')
  .description('Operate on a single memory by id (see `lumo task memory` / `lumo project memory` to list/add)')

memoryCmd
  .command('promote <memoryId>')
  .description('Promote a TASK memory to PROJECT scope. Only when the lesson recurs across 2+ tasks.')
  .action(wrap((id: unknown) => memoryPromote(id as string)))

memoryCmd
  .command('rm <memoryId>')
  .description('Delete a memory (hard delete). Requires --yes.')
  .option('--yes', 'Confirm deletion')
  .action(wrap((id: unknown, opts: unknown) => memoryRm(id as string, opts as { yes?: boolean })))
```

- [ ] **Step 4: Write the failing test** — `__tests__/cli/memory-promote-action.test.ts`:
```ts
/** @jest-environment node */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: () => ({ token: 'tok', apiUrl: 'https://x', workspaceSlug: 'ws' }),
}))
import { memoryPromote } from '@/cli/src/commands/memory-promote'
import { memoryRm } from '@/cli/src/commands/memory-rm'

afterEach(() => jest.restoreAllMocks())

it('PATCHes scope=PROJECT and reports success', async () => {
  const out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  let captured: any
  jest.spyOn(global, 'fetch').mockImplementation(((url: any, init: any) => {
    captured = { url: String(url), init }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ memory: { id: 'm1' } }) } as Response)
  }) as any)
  const code = await memoryPromote('m1')
  expect(code).toBeUndefined()
  expect(captured.url).toContain('/api/memories/m1')
  expect(captured.init.method).toBe('PATCH')
  expect(JSON.parse(captured.init.body)).toEqual({ scope: 'PROJECT' })
  expect(out).toHaveBeenCalledWith(expect.stringMatching(/Promoted m1 to PROJECT/))
})

it('surfaces 409 already-project', async () => {
  const err = jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 409 } as Response)
  expect(await memoryPromote('m1')).toBe(1)
  expect(err).toHaveBeenCalledWith(expect.stringMatching(/already project-scoped/))
})

it('rm refuses without --yes (no network)', async () => {
  const fetchSpy = jest.spyOn(global, 'fetch')
  const err = jest.spyOn(console, 'error').mockImplementation(() => {})
  expect(await memoryRm('m1', {})).toBe(1)
  expect(fetchSpy).not.toHaveBeenCalled()
  expect(err).toHaveBeenCalledWith(expect.stringMatching(/--yes/))
})

it('rm DELETEs with --yes (204)', async () => {
  const out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  let captured: any
  jest.spyOn(global, 'fetch').mockImplementation(((url: any, init: any) => {
    captured = { url: String(url), init }
    return Promise.resolve({ ok: true, status: 204 } as Response)
  }) as any)
  const code = await memoryRm('m1', { yes: true })
  expect(code).toBeUndefined()
  expect(captured.init.method).toBe('DELETE')
  expect(out).toHaveBeenCalledWith(expect.stringMatching(/Deleted memory m1/))
})
```

- [ ] **Step 5: Run + typecheck** — `npx jest memory-promote-action && npx tsc --noEmit` (prisma generate first if the race triggers). Expected PASS + clean.

- [ ] **Step 6: Commit**
```bash
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-70-memory-management-ui add cli/src/commands/memory-promote.ts cli/src/commands/memory-rm.ts cli/src/index.ts __tests__/cli/memory-promote-action.test.ts
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-70-memory-management-ui commit -m "feat(cli): lumo memory promote/rm [LUM-70]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: SKILL.md `## Memory management` section + frontmatter triggers

**Files:**
- Modify: `.claude/skills/lumo/SKILL.md`

- [ ] **Step 1: Read the current SKILL.md** to find the frontmatter `description` and a good insertion point (e.g. after the Sprint or Document section, before "Session Management" or at the end of the task-related sections). Match the existing heading style.

- [ ] **Step 2: Add trigger words to the frontmatter `description`** — append to the existing `Triggers on:` list (keep it one field, comma-separated): `"memory", "记忆", "remember", "record a memory", "记一条", "promote memory", "promote to project", "沉淀", "task memory", "project memory", "lumo memory"`.

- [ ] **Step 3: Insert the `## Memory management` section** (verbatim — this is the agent-facing guidance prompt; wording is shared with the CLI `--help`/tips):
````markdown
## Memory management

Record and curate the long-term Memory that Claude reads on future sessions.
Memories are scoped **TASK** (useful only for one task) or **PROJECT** (useful
across the whole project). Automated extraction (layer1) and promotion (layer2,
on task→done) already run; these commands are the manual override.

### Commands

```bash
# List
lumo task memory list [LUM-N] [--category trap|decision|convention|procedural] [-n N]
lumo project memory list [<project>] [--category ...] [-n N]

# Add (per-category fields; <task>/<project> default to the session-bound task)
lumo task memory add [LUM-N] --category trap --trigger "..." --outcome "..." [--workaround "..."]
lumo task memory add [LUM-N] --category decision --what "..." --why "..." [--alternatives "..."] [--implications "..."]
lumo task memory add [LUM-N] --category convention --rule "..." --applies "..."
lumo task memory add [LUM-N] --category procedural --workflow "..." --trigger "..." [--step "..." --step "..."]
lumo project memory add [<project>] --category ...   # same flags; records at PROJECT scope

# Single-memory ops (memoryId from `... memory list` column 1)
lumo memory promote <memoryId>     # TASK → PROJECT
lumo memory rm <memoryId> --yes    # hard delete
```

When the session is bound (`lumo session attach <LUM-N>`), omit the identifier:
`lumo task memory add --category trap --trigger ... --outcome ...` records onto
the bound task; `lumo project memory add ...` records onto its project.

### When to record a memory (worthiness)

Record only knowledge that is **invisible in the codebase** — the *why* behind a
choice, a gotcha that only surfaces at runtime, a rule that lives in people's
heads, a non-obvious failure cause, a non-trivial workflow. **Skip** routine work
(reading files, plain edits, normal git, successful builds) and anything a
developer could learn from the source, git log, or docs. When unsure, don't.

### Which category

- `trap` — a pitfall. Describe the PROBLEM ONLY (`--trigger`, `--outcome`); put any fix in a separate `procedural`.
- `decision` — an engineering decision (`--what` + `--why`, optional `--alternatives`/`--implications`).
- `convention` — a team rule (`--rule` + `--applies` = where it applies).
- `procedural` — a reusable workflow (`--workflow` + `--trigger` + `--step`…).

### TASK vs PROJECT (at add time)

Default to **TASK** (`lumo task memory add`). Record directly to **PROJECT**
(`lumo project memory add`) only when it helps *any* task in the project: a
toolchain/environment trap, a team-wide convention, a cross-task decision. When
unsure → TASK.

### When to promote (TASK → PROJECT)

`lumo memory promote <id>` only when the lesson **recurs across 2+ different
tasks**, would help a *different* task, and no equivalent PROJECT memory exists.
A wrong promotion is costly (every agent sees it forever) — prefer leaving it at TASK.

### When to reach for this

After a non-trivial debugging session, a pitfall you hit, or establishing a
convention → consider `lumo task memory add`. When you notice a lesson recurring
across multiple tasks → consider `lumo memory promote`.
````

- [ ] **Step 4: Verify the skill file is still well-formed** — `node -e "require('fs').readFileSync('.claude/skills/lumo/SKILL.md','utf8')"` (sanity read) and eyeball the frontmatter is still valid YAML (the `description:` is one quoted string).

- [ ] **Step 5: Commit**
```bash
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-70-memory-management-ui add .claude/skills/lumo/SKILL.md
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-70-memory-management-ui commit -m "docs(skill): memory management commands + worthiness guidance [LUM-70]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Version bump + build + final verification

**Files:**
- Modify: `cli/package.json`

- [ ] **Step 1: Bump CLI version** — in `cli/package.json`, `"version": "1.4.0"` → `"1.5.0"`.

- [ ] **Step 2: Build the CLI** — `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-70-memory-management-ui/cli && npm run build` → tsc compiles, assets bundle, exit 0. Fix any type errors in the new command/lib files.

- [ ] **Step 3: Smoke the CLI help locally** (proves commander registration resolves):
```bash
node /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-70-memory-management-ui/cli/dist/cli/src/index.js task memory --help
node .../cli/dist/cli/src/index.js project memory --help
node .../cli/dist/cli/src/index.js memory --help
```
Expected: each prints the subcommands/flags (list/add, or promote/rm). A non-zero exit or "unknown command" = registration bug.

- [ ] **Step 4: Full memory + cli test run + typecheck**
```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-70-memory-management-ui
npx prisma generate >/dev/null 2>&1
npx jest memory-content resolve-bound-task memory-add-action memory-promote-action
npx tsc --noEmit
```
Expected: all PASS, tsc clean.

- [ ] **Step 5: Commit + push to update PR #174**
```bash
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-70-memory-management-ui add cli/package.json
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-70-memory-management-ui commit -m "chore(cli): bump @lumoai/cli 1.4.0 → 1.5.0 for memory commands [LUM-70]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git -C /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-70-memory-management-ui push
```

---

## Self-Review (completed by plan author)

**1. Spec coverage:**
- ✅ Command shape C (nested list/add + singleton promote/rm) — Tasks 3, 4, 5.
- ✅ Per-category flags (A) + `--applies`→scope + repeatable `--step` — Task 1 `buildMemoryContent`.
- ✅ Session-binding default — Task 2 + Tasks 3/4 (task & project fall back to bound task / its project).
- ✅ No `edit`, no data-driven warning — absent by construction; tips are static (Tasks 3/5).
- ✅ Guidance in SKILL.md (A) + CLI help + post-action tips (D) — Task 6 + descriptions/tips in Tasks 3/4/5.
- ✅ list `auto`/`manual` source token (spec self-review fix) — Task 1 `formatMemoryList`.
- ✅ No backend changes; reuse `/api/tasks/resolve`, `/api/projects`, `/api/tasks/by-identifier`, `/api/sessions`, `/api/{tasks,projects}/[id]/memories`, `/api/memories/[id]`.
- ✅ CLI version bump — Task 7.

**2. Placeholder scan:** No TBD/TODO. The two "read X to confirm the field name" notes (by-identifier `task.project.id`; SKILL.md insertion point) are verification steps with a concrete fallback, not placeholders.

**3. Type consistency:** `buildMemoryContent` returns `{ ok, category, content } | { ok:false, error }` — consumed identically in `memory-task-add` and `memory-project-add`. `MemoryRowLike` shape shared by `formatMemoryList` and both list commands. `resolveBoundTaskIdentifier(apiUrl, token)` signature consistent across callers. `resolveProjectIdByRef`/`resolveBoundProjectId` return the same `{ ok, id } | { ok:false, error }` discriminated shape, consumed identically.

**4. Gaps fixed during review:**
- The memory task route takes a task **cuid**, not LUM-N → added explicit `/api/tasks/resolve/<LUM-N>` resolution in the task commands (Task 3), unlike the artifact route which server-resolves.
- `project memory` from binding needs task→project → added `resolveBoundProjectId` via `/api/tasks/by-identifier` (Task 4) with a field-name verification note.
- `--applies` (not `--scope`) avoids collision with memory scope — enforced in `buildMemoryContent` + flag definitions.
````
