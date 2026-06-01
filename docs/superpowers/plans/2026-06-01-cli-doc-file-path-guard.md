# Doc `--file` Path Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the existing `checkArtifactFilePath` guard to the `--file` channel of `lumo doc create` and `lumo doc update`, closing the same agent-exploitable file-exfiltration path that LUM-141 fixed for `task artifact add`.

**Architecture:** Both commands read `--file` through one chokepoint — `resolveDocContent` in `cli/src/lib/doc-input.ts`. Guard the **file branch only** inside `resolveDocContent` (leaving `--content` and stdin untouched), returning the existing `{ kind: 'error', message }` shape so both call sites reject before any network call with zero call-site changes. The guard is injected as an optional `checkFilePath` dep (defaults to `checkArtifactFilePath`) so tests stay pure.

**Tech Stack:** TypeScript (CLI, strict), Jest (`__tests__/cli/`, `@jest-environment node`). Reuses `cli/src/lib/path-guard.ts` from LUM-141.

**Working directory:** All paths relative to the worktree `/Users/chaoli/Desktop/lumo/lumo/.worktrees/cli-doc-file-path-guard` (branched off `lumo/LUM-141-artifact-file-path-guard`, so `path-guard.ts` is present). Run all commands from there.

**Git safety:** shared multi-worktree checkout — NEVER `git checkout`/`switch`/`reset`/`stash`/`rebase`/`merge`. Only `git add`/`git commit` files each task names.

---

### Task 1: Guard the file branch inside `resolveDocContent`

**Files:**
- Modify: `cli/src/lib/doc-input.ts`
- Test: `__tests__/cli/doc-input.test.ts`

- [ ] **Step 1: Update existing tests + add failing guard tests**

In `__tests__/cli/doc-input.test.ts`:

(a) Two existing tests pass a `file:` and expect `ok`; once the guard is wired with its real default they would be rejected (paths outside cwd). Make them inject a permissive `checkFilePath`.

In `it('returns content from --file', ...)` — add `checkFilePath` to the `resolveDocContent({...})` call so it returns ok with the temp path:
```ts
      readFile: async p => fs.promises.readFile(p, 'utf8'),
      checkFilePath: () => ({ ok: true, resolved: tmp }),
```

In `it('prefers --file over non-TTY stdin (silently ignores stdin)', ...)` — add to its `resolveDocContent({...})` call:
```ts
      readFile: async () => 'from-file',
      checkFilePath: () => ({ ok: true, resolved: '/tmp/x.md' }),
```

(b) Append four new tests to the `describe('resolveDocContent', ...)` block:
```ts
  it('rejects a sensitive --file via the path guard', async () => {
    const result = await resolveDocContent({
      content: undefined,
      file: '.env',
      stdinIsTTY: true,
      readStdin: async () => '',
      readFile: async () => 'SECRET=1',
      checkFilePath: () => ({
        ok: false,
        reason: 'sensitive',
        detail: 'matches .env',
      }),
    })
    expect(result.kind).toBe('error')
    if (result.kind === 'error')
      expect(result.message).toContain('refusing to read')
  })

  it('rejects an outside-project --file and never reads it', async () => {
    let read = false
    const result = await resolveDocContent({
      content: undefined,
      file: '../../etc/passwd',
      stdinIsTTY: true,
      readStdin: async () => '',
      readFile: async () => {
        read = true
        return 'x'
      },
      checkFilePath: () => ({
        ok: false,
        reason: 'outside-project',
        detail: 'resolves outside project directory',
      }),
    })
    expect(result.kind).toBe('error')
    if (result.kind === 'error')
      expect(result.message).toContain('refusing to read')
    expect(read).toBe(false)
  })

  it('maps an unreadable guard verdict to a plain message', async () => {
    const result = await resolveDocContent({
      content: undefined,
      file: 'missing.md',
      stdinIsTTY: true,
      readStdin: async () => '',
      readFile: async () => '',
      checkFilePath: () => ({
        ok: false,
        reason: 'unreadable',
        detail: 'path does not resolve',
      }),
    })
    expect(result.kind).toBe('error')
    if (result.kind === 'error')
      expect(result.message).toContain('could not read file')
  })

  it('reads the canonical resolved path on an ok verdict', async () => {
    let readArg = ''
    const result = await resolveDocContent({
      content: undefined,
      file: 'docs/spec.md',
      stdinIsTTY: true,
      readStdin: async () => '',
      readFile: async p => {
        readArg = p
        return '# Spec'
      },
      checkFilePath: () => ({ ok: true, resolved: '/proj/docs/spec.md' }),
    })
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') expect(result.markdown).toBe('# Spec')
    expect(readArg).toBe('/proj/docs/spec.md')
  })
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx jest doc-input`
Expected: FAIL — `checkFilePath` is not yet a recognized arg / the guard isn't applied, so the four new tests fail (and the two edited tests may fail too until the impl reads `check.resolved`). The "outside-project never reads it" and "reads the canonical resolved path" assertions will fail.

- [ ] **Step 3: Implement the guard in `cli/src/lib/doc-input.ts`**

Add the import at the top (after `import * as fs from 'fs'`):
```ts
import { checkArtifactFilePath, type PathGuardResult } from './path-guard'
```

Add the optional dep to the `ResolveDocContentArgs` interface (after the `readFile` field):
```ts
  /**
   * Path-safety guard for the --file branch. Defaults to checkArtifactFilePath,
   * which confines the path to the project directory and rejects sensitive
   * files. Injectable so tests don't touch the real filesystem.
   */
  checkFilePath?: (p: string) => PathGuardResult
```

Replace the existing file branch in `resolveDocContent`:
```ts
  if (hasFile) {
    const text = await args.readFile(args.file as string)
    return { kind: 'ok', markdown: text }
  }
```
with:
```ts
  if (hasFile) {
    const check = (args.checkFilePath ?? checkArtifactFilePath)(
      args.file as string
    )
    if (!check.ok) {
      return {
        kind: 'error',
        message:
          check.reason === 'unreadable'
            ? `could not read file ${args.file}`
            : `refusing to read ${args.file} — ${check.detail}. ` +
              `--file must be a non-sensitive path inside the project directory.`,
      }
    }
    const text = await args.readFile(check.resolved)
    return { kind: 'ok', markdown: text }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest doc-input`
Expected: PASS (all original + 4 new tests).

Run: `npx tsc --noEmit` — confirm no new errors in `cli/src/lib/doc-input.ts` or `__tests__/cli/doc-input.test.ts`.

- [ ] **Step 5: Commit**
```bash
git add cli/src/lib/doc-input.ts __tests__/cli/doc-input.test.ts
git commit -m "feat: guard doc --file reads against path traversal and secrets [LUM-141]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Command-level rejection tests for `doc create` / `doc update`

**Files:**
- Create: `__tests__/cli/doc-create-file-guard.test.ts`
- Create: `__tests__/cli/doc-update-file-guard.test.ts`

These prove the guard wires through each command and short-circuits before the network call. They mock the path-guard module (so the real `resolveDocContent` rejects), mock auth, and spy `fetch`.

- [ ] **Step 1: Write `__tests__/cli/doc-create-file-guard.test.ts`**
```ts
/** @jest-environment node */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'lum_x',
    apiUrl: 'https://api.test',
    workspaceSlug: 'lumo',
  })),
}))
jest.mock('@/cli/src/lib/path-guard', () => ({
  checkArtifactFilePath: jest.fn(() => ({
    ok: false,
    reason: 'sensitive',
    detail: 'matches .env',
  })),
}))

import { docCreate } from '@/cli/src/commands/doc-create'

describe('docCreate --file path guard', () => {
  afterEach(() => jest.restoreAllMocks())

  it('rejects a sensitive --file and never calls the API', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({}),
      } as unknown as Response)
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const code = await docCreate('My Doc', { file: '../../secret.env' })
    expect(code).toBe(1)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('refusing to read')
    )
  })
})
```

- [ ] **Step 2: Write `__tests__/cli/doc-update-file-guard.test.ts`**

`doc update` resolves the doc id (via `lookupDocId`) before reading content, so mock that too.
```ts
/** @jest-environment node */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'lum_x',
    apiUrl: 'https://api.test',
    workspaceSlug: 'lumo',
  })),
}))
jest.mock('@/cli/src/lib/resolve-doc-id', () => ({
  lookupDocId: jest.fn(async () => 'cmd_x'),
}))
jest.mock('@/cli/src/lib/path-guard', () => ({
  checkArtifactFilePath: jest.fn(() => ({
    ok: false,
    reason: 'outside-project',
    detail: 'resolves outside project directory',
  })),
}))

import { docUpdate } from '@/cli/src/commands/doc-update'

describe('docUpdate --file path guard', () => {
  afterEach(() => jest.restoreAllMocks())

  it('rejects an outside-project --file and never calls the API', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      } as unknown as Response)
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const code = await docUpdate('My Doc', { file: '/etc/passwd' })
    expect(code).toBe(1)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('refusing to read')
    )
  })
})
```

- [ ] **Step 3: Run both new suites**

Run: `npx jest doc-create-file-guard doc-update-file-guard`
Expected: PASS (2 suites, 2 tests). If a suite errors because the command reaches `fetch` (guard not wired), Task 1 was incomplete — fix Task 1 first.

Run: `npx tsc --noEmit` — confirm no new errors in the two new test files.

- [ ] **Step 4: Commit**
```bash
git add __tests__/cli/doc-create-file-guard.test.ts __tests__/cli/doc-update-file-guard.test.ts
git commit -m "test: doc create/update --file reject sensitive paths pre-network [LUM-141]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Document the `--file` sandbox in SKILL.md

**Files:**
- Modify: `.claude/skills/lumo/SKILL.md` (doc create section ~line 586, doc update section ~line 629)

- [ ] **Step 1: Add a note to the `doc create` section**

Find this exact line (in the `### \`lumo doc create [title] [flags]\`` section):
```
The three content channels (`--content`, `--file`, stdin) are mutually exclusive — specify at most one.
```
Append a new sentence to that same line:
```
 **`--file` is sandboxed:** the CLI rejects a path that resolves outside the current project directory (parent-traversal, absolute, escaping symlinks) or matches a sensitive-file denylist (`.env*`, private keys, `*.pem`/`*.key`, `credentials`, `.ssh`/`.aws` contents, …). Pass only project-local, non-secret files; there is no override flag.
```

- [ ] **Step 2: Add a parallel note to the `doc update` section**

In the `### \`lumo doc update <doc> [flags]\`` section there is an options table whose `--file` row reads `Replace content from file.`. Immediately AFTER that table (before the section's `Examples:` block), add a new standalone paragraph:
```
Like `doc create`, `--file` is sandboxed: the CLI rejects paths that resolve outside the project directory or match the sensitive-file denylist (`.env*`, private keys, `credentials`, …). No override flag.
```
Read the section first to place it correctly (after the table's last row, on its own line with a blank line before and after).

- [ ] **Step 3: Verify and commit**

Run: `grep -n "sandboxed" .claude/skills/lumo/SKILL.md`
Expected: two matches — one in the doc create section, one referencing doc update (the `doc update` note uses "sandboxed" too). If the update note used different wording, confirm it is present near the `doc update` `--file` row.

```bash
git add .claude/skills/lumo/SKILL.md
git commit -m "docs: note doc create/update --file sandbox in SKILL.md [LUM-141]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Full verification

**Files:** none

- [ ] **Step 1: Type-check**

Run: `npx tsc --noEmit`
Expected: clean (no errors in touched files). Pre-existing unrelated noise, if any, should not reference `doc-input.ts`, `doc-create.ts`, `doc-update.ts`, or the new test files.

- [ ] **Step 2: Full CLI suite**

Run: `npx jest __tests__/cli`
Expected: all suites pass, including `doc-input`, `doc-create-file-guard`, `doc-update-file-guard`, and the untouched `doc-create-format` / `doc-update-format`.

- [ ] **Step 3: No stray console.log**

Run: `grep -n "console.log" cli/src/lib/doc-input.ts cli/src/commands/doc-create.ts cli/src/commands/doc-update.ts`
Expected: no matches.

- [ ] **Step 4: Confirm stdin / --content paths are NOT guarded**

Re-read the `resolveDocContent` diff: the guard must be INSIDE the `if (hasFile)` branch only. The `--content` and stdin branches must be unchanged (no `checkFilePath` call). Confirm the existing `--content` / stdin tests in `doc-input.test.ts` still pass untouched.

---

## Self-Review notes

- **Spec coverage:** guard at the chokepoint (Task 1), only the file branch guarded / content+stdin untouched (Task 1 impl + Task 4 Step 4), both commands reject pre-network (Task 2), SKILL.md create+update notes (Task 3), tests inject fake guard / no real fs (Task 1, 2). All requirements from the task map to a step.
- **Type consistency:** `checkFilePath?: (p: string) => PathGuardResult`, the `{ ok, reason, detail, resolved }` shape, and `checkArtifactFilePath` match the LUM-141 `path-guard.ts` exports exactly. The `{ kind: 'error', message }` / `{ kind: 'ok', markdown }` shapes match the existing `ResolveDocContentResult`.
- **No placeholders:** every code/test block is concrete; every run step lists command + expected outcome.
