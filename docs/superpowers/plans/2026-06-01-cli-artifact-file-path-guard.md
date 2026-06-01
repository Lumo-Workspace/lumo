# Artifact `--file` Path Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `lumo task artifact add --file` from reading and uploading files outside the project directory or matching a sensitive-file denylist, closing an agent-exploitable exfiltration path.

**Architecture:** A new pure, dependency-injected guard module `cli/src/lib/path-guard.ts` decides whether a `--file` path is safe. `task-artifact-add.ts` calls it before any filesystem read or network request and aborts with exit code 1 on rejection. No override flag. Tests inject fake `cwd`/`realpath` so no real filesystem is touched.

**Tech Stack:** TypeScript (CLI, strict mode), Node `fs`/`path`, Jest (repo-root `__tests__/cli/`, `@jest-environment node`).

**Working directory:** All paths below are relative to the worktree `/Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-141-artifact-file-path-guard`. Run all `git`/`npx`/`npm` commands from that directory.

---

### Task 1: Sensitive-name denylist (`matchSensitiveName`)

**Files:**
- Create: `cli/src/lib/path-guard.ts`
- Test: `__tests__/cli/path-guard.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/cli/path-guard.test.ts`:

```ts
/** @jest-environment node */
import { matchSensitiveName } from '@/cli/src/lib/path-guard'

describe('matchSensitiveName', () => {
  it('passes an ordinary spec file', () => {
    expect(matchSensitiveName('docs/spec.md')).toBeNull()
    expect(matchSensitiveName('plan.md')).toBeNull()
  })

  it('flags dotenv files', () => {
    expect(matchSensitiveName('.env')).not.toBeNull()
    expect(matchSensitiveName('config/.env.local')).not.toBeNull()
    expect(matchSensitiveName('.env.production')).not.toBeNull()
  })

  it('flags private keys by name and extension', () => {
    expect(matchSensitiveName('id_rsa')).not.toBeNull()
    expect(matchSensitiveName('keys/id_ed25519')).not.toBeNull()
    expect(matchSensitiveName('server.pem')).not.toBeNull()
    expect(matchSensitiveName('cert.key')).not.toBeNull()
  })

  it('flags credential-bearing files and segments', () => {
    expect(matchSensitiveName('.aws/credentials')).not.toBeNull()
    expect(matchSensitiveName('/Users/x/.ssh/known_hosts')).not.toBeNull()
    expect(matchSensitiveName('.npmrc')).not.toBeNull()
  })

  it('is case-insensitive on the basename', () => {
    expect(matchSensitiveName('Server.PEM')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest path-guard`
Expected: FAIL — `Cannot find module '@/cli/src/lib/path-guard'` (file not created yet).

- [ ] **Step 3: Write the minimal implementation**

Create `cli/src/lib/path-guard.ts`:

```ts
import * as fs from 'fs'
import * as path from 'path'

const SENSITIVE_SEGMENTS = ['.ssh', '.aws', '.gnupg']
const SENSITIVE_BASENAMES = [
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'credentials',
  '.npmrc',
  '.netrc',
  '.pgpass',
  '.htpasswd',
]
const SENSITIVE_EXTENSIONS = ['.pem', '.key', '.pfx', '.p12']

/**
 * Pure denylist check. Returns a human-readable reason when the path looks
 * like a secret, or null when it is acceptable. Matches the basename
 * (case-insensitive) and path segments; no filesystem access.
 */
export function matchSensitiveName(p: string): string | null {
  const segments = p.split(/[\\/]+/).filter(Boolean)
  for (const seg of segments) {
    if (SENSITIVE_SEGMENTS.includes(seg.toLowerCase())) {
      return `path contains ${seg}`
    }
  }
  const base = (segments[segments.length - 1] ?? '').toLowerCase()
  if (base === '.env' || base.startsWith('.env.')) return 'matches .env'
  if (SENSITIVE_BASENAMES.includes(base)) return `matches ${base}`
  for (const ext of SENSITIVE_EXTENSIONS) {
    if (base.endsWith(ext)) return `matches *${ext}`
  }
  return null
}
```

(`fs` and `path` are imported now; they are used by `checkArtifactFilePath` in Task 2. If your linter flags the unused imports between tasks, proceed — Task 2 consumes them in the same commit boundary is fine, but to keep Task 1 lint-clean you may add the imports in Task 2 instead. Either way the final file imports both.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest path-guard`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/src/lib/path-guard.ts __tests__/cli/path-guard.test.ts
git commit -m "feat: add sensitive-filename denylist for CLI path guard [LUM-141]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Project-confinement guard (`checkArtifactFilePath`)

**Files:**
- Modify: `cli/src/lib/path-guard.ts`
- Test: `__tests__/cli/path-guard.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `__tests__/cli/path-guard.test.ts`:

```ts
import { checkArtifactFilePath } from '@/cli/src/lib/path-guard'

describe('checkArtifactFilePath', () => {
  // Fake fs: cwd is /proj; realpath maps a few known paths and otherwise
  // echoes the input. Symlink + missing-file cases are modeled explicitly.
  const cwd = () => '/proj'
  const makeRealpath =
    (overrides: Record<string, string | Error> = {}) =>
    (p: string): string => {
      const hit = overrides[p]
      if (hit instanceof Error) throw hit
      if (typeof hit === 'string') return hit
      return p // identity for plain paths that "exist"
    }

  it('accepts an ordinary in-project file', () => {
    const r = checkArtifactFilePath('docs/spec.md', {
      cwd,
      realpath: makeRealpath(),
    })
    expect(r).toEqual({ ok: true, resolved: '/proj/docs/spec.md' })
  })

  it('rejects parent-traversal paths', () => {
    const r = checkArtifactFilePath('../../etc/passwd', {
      cwd,
      realpath: makeRealpath(),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('outside-project')
  })

  it('rejects absolute paths outside the project', () => {
    const r = checkArtifactFilePath('/Users/x/secret.txt', {
      cwd,
      realpath: makeRealpath(),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('outside-project')
  })

  it('rejects a symlink that escapes the project', () => {
    // notes.md lives in /proj but realpath resolves it outside
    const r = checkArtifactFilePath('notes.md', {
      cwd,
      realpath: makeRealpath({ '/proj/notes.md': '/Users/x/.ssh/id_rsa' }),
    })
    expect(r.ok).toBe(false)
    // caught by the sensitive denylist on the canonical path
    if (!r.ok) expect(r.reason).toBe('sensitive')
  })

  it('rejects an in-project sensitive file', () => {
    const r = checkArtifactFilePath('.env', { cwd, realpath: makeRealpath() })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('sensitive')
  })

  it('reports unreadable when realpath throws', () => {
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    const r = checkArtifactFilePath('missing.md', {
      cwd,
      realpath: makeRealpath({ '/proj/missing.md': enoent }),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('unreadable')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest path-guard`
Expected: FAIL — `checkArtifactFilePath is not a function` / not exported.

- [ ] **Step 3: Write the minimal implementation**

Append to `cli/src/lib/path-guard.ts`:

```ts
export interface PathGuardDeps {
  cwd: () => string
  realpath: (p: string) => string
}

export type PathGuardResult =
  | { ok: true; resolved: string }
  | { ok: false; reason: 'sensitive'; detail: string }
  | { ok: false; reason: 'outside-project'; detail: string }
  | { ok: false; reason: 'unreadable'; detail: string }

/**
 * Decide whether `rawPath` is safe to read and upload as an artifact body.
 * Two layers: (1) it must resolve to a real path inside the project directory
 * (cwd), and (2) neither the raw nor the canonical path may match the
 * sensitive-filename denylist. realpath defeats symlinks that escape the tree.
 */
export function checkArtifactFilePath(
  rawPath: string,
  deps?: Partial<PathGuardDeps>
): PathGuardResult {
  const cwd = deps?.cwd ?? process.cwd
  const realpath = deps?.realpath ?? fs.realpathSync

  // 1. Fail fast on the raw path (no fs access).
  const rawHit = matchSensitiveName(rawPath)
  if (rawHit) return { ok: false, reason: 'sensitive', detail: rawHit }

  const root = cwd()
  const absolute = path.resolve(root, rawPath)

  // 2. Canonicalize. realpath throws if the path does not exist / is unreadable.
  let resolved: string
  let rootReal: string
  try {
    resolved = realpath(absolute)
    rootReal = realpath(root)
  } catch {
    return { ok: false, reason: 'unreadable', detail: 'path does not resolve' }
  }

  // 3. Re-check the denylist on the canonical path (catches innocent-looking
  //    symlinks pointing at a secret).
  const canonHit = matchSensitiveName(resolved)
  if (canonHit) return { ok: false, reason: 'sensitive', detail: canonHit }

  // 4. Confinement: the canonical path must be inside the project root.
  if (resolved !== rootReal && !resolved.startsWith(rootReal + path.sep)) {
    return {
      ok: false,
      reason: 'outside-project',
      detail: 'resolves outside project directory',
    }
  }

  return { ok: true, resolved }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest path-guard`
Expected: PASS (all `matchSensitiveName` + `checkArtifactFilePath` tests).

- [ ] **Step 5: Commit**

```bash
git add cli/src/lib/path-guard.ts __tests__/cli/path-guard.test.ts
git commit -m "feat: confine artifact --file to the project directory [LUM-141]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Wire the guard into `task artifact add`

**Files:**
- Modify: `cli/src/commands/task-artifact-add.ts` (the read block, currently lines ~64-70)
- Test: `__tests__/cli/task-artifact-add.test.ts`

- [ ] **Step 1: Write the failing test**

Edit `__tests__/cli/task-artifact-add.test.ts`. Add a mock for the path guard at the top, next to the existing mocks (after the `doc-input` mock, before the `import { taskArtifactAdd }` line):

```ts
jest.mock('@/cli/src/lib/path-guard', () => ({
  checkArtifactFilePath: jest.fn(() => ({ ok: true, resolved: '/proj/f.md' })),
}))
```

Add this import beneath the existing imports:

```ts
import { checkArtifactFilePath } from '@/cli/src/lib/path-guard'
```

Add a new test inside the `describe('taskArtifactAdd', …)` block:

```ts
it('refuses a sensitive --file and never calls the API', async () => {
  ;(checkArtifactFilePath as jest.Mock).mockReturnValueOnce({
    ok: false,
    reason: 'sensitive',
    detail: 'matches .env',
  })
  const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(okCreated)
  const code = await taskArtifactAdd('LUM-9', {
    kind: 'spec',
    title: 'Spec',
    file: '../../secret.env',
    source: 'superpowers',
    agent: 'claude-code',
  })
  expect(code).toBe(1)
  expect(fetchSpy).not.toHaveBeenCalled()
})
```

Note: `beforeEach(() => jest.restoreAllMocks())` already runs; the module-level
`checkArtifactFilePath` mock keeps its default `ok` implementation across tests
because `restoreAllMocks` only resets spies created via `jest.spyOn`, not
`jest.fn()` factory mocks. The happy-path test therefore still sees `ok: true`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest task-artifact-add`
Expected: FAIL — the new test fails because the command does not yet consult the guard (it would try `readFileUtf8` and POST). The mocked `readFileUtf8` returns content, so `fetch` IS called → `expect(fetchSpy).not.toHaveBeenCalled()` fails.

- [ ] **Step 3: Write the implementation**

In `cli/src/commands/task-artifact-add.ts`:

Add the import beneath the existing imports (after the `normalizeAgent` import line):

```ts
import { checkArtifactFilePath } from '../lib/path-guard'
```

Replace the existing read block:

```ts
  let content: string
  try {
    content = await readFileUtf8(options.file)
  } catch {
    console.error(`Error: could not read file ${options.file}`)
    return 1
  }
```

with:

```ts
  const verdict = checkArtifactFilePath(options.file)
  if (!verdict.ok) {
    if (verdict.reason === 'unreadable') {
      console.error(`Error: could not read file ${options.file}`)
    } else {
      console.error(
        `Error: refusing to read ${options.file} — ${verdict.detail}. ` +
          `artifact --file must be a non-sensitive path inside the project directory.`
      )
    }
    return 1
  }

  let content: string
  try {
    content = await readFileUtf8(verdict.resolved)
  } catch {
    console.error(`Error: could not read file ${options.file}`)
    return 1
  }
```

(The `if (!options.file)` guard above this block already narrows `options.file`
to a defined string, so `checkArtifactFilePath(options.file)` type-checks.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest task-artifact-add`
Expected: PASS — the new refusal test passes (no fetch), and all existing tests (missing kind/source/agent, happy-path POST) still pass.

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/task-artifact-add.ts __tests__/cli/task-artifact-add.test.ts
git commit -m "feat: guard artifact add --file against path traversal and secrets [LUM-141]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Document the constraint in SKILL.md

**Files:**
- Modify: `.claude/skills/lumo/SKILL.md` (the `lumo task artifact add` subsection, around line 385)

- [ ] **Step 1: Edit the `artifact add` description**

In `.claude/skills/lumo/SKILL.md`, find the paragraph ending with:

```
`--file` supplies the body (file contents). Each call appends to the end of the task's artifact list — call once per artifact (e.g. Superpowers: one `spec`, one `plan`). The `<task>` (e.g. `LUM-42`) is resolved server-side.
```

Append this sentence to that paragraph (same line, after "resolved server-side."):

```
 **`--file` is sandboxed:** the CLI rejects any path that resolves **outside the current project directory** (parent-traversal, absolute paths, escaping symlinks) or that matches a **sensitive-file denylist** (`.env*`, `id_rsa`/`id_ed25519`, `*.pem`/`*.key`, `.aws`/`.ssh` contents, `credentials`, `.npmrc`, …). There is no override flag — pass only project-local, non-secret files (e.g. `docs/spec.md`). To record an out-of-tree file, copy it into the project first.
```

Then update the frontmatter `description` trigger list (line 3): nothing new to add — the existing `"artifact add"` / `"spec artifact"` triggers already cover this command, and no new subcommand or flag was introduced. (Per CLAUDE.md, only new usages need new triggers; this is a behavior constraint on an existing flag, so the doc body update above is sufficient.)

- [ ] **Step 2: Verify the bundled asset is regenerated from source**

The bundled copy (`cli/assets/skill.md`) is regenerated from `.claude/skills/lumo/SKILL.md` by `cli/scripts/bundle-assets.js` during `npm run build`. No manual edit of the asset is required. Confirm the source path is the one edited:

Run: `grep -n "sandboxed" .claude/skills/lumo/SKILL.md`
Expected: one match in the `artifact add` paragraph.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/lumo/SKILL.md
git commit -m "docs: note artifact --file sandbox in SKILL.md [LUM-141]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Full verification

**Files:** none (verification + final checks)

- [ ] **Step 1: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors. (If "TaskArtifact not exported / stale client" style errors appear, they are unrelated stale-generated-client noise — run `npx prisma generate` and re-run. The path-guard change touches only the CLI and adds no Prisma usage.)

- [ ] **Step 2: Run the full CLI test suite**

Run: `npx jest __tests__/cli`
Expected: PASS — including `path-guard.test.ts` and `task-artifact-add.test.ts`.

- [ ] **Step 3: Confirm no stray `console.log`**

Run: `grep -n "console.log" cli/src/lib/path-guard.ts cli/src/commands/task-artifact-add.ts`
Expected: no matches (the command uses `console.error` for errors and `process.stdout.write` for success, which is the existing pattern).

- [ ] **Step 4: Sanity-build the CLI (regenerates bundled SKILL asset)**

Run: `cd cli && npm run build && cd ..`
Expected: build succeeds; `cli/assets/skill.md` now contains the "sandboxed" note. (If `npm run build` is not desired in the worktree, this step is optional — CI/packaging regenerates the asset. The source-of-truth `.claude/skills/lumo/SKILL.md` is what matters for the running agent.)

- [ ] **Step 5: Flag the sibling commands as follow-up**

`doc create --file` and `doc update --file` share the same unguarded read
pattern but are out of scope for LUM-141. After this plan is implemented and
reviewed, flag them via `mcp__ccd_session__spawn_task` (or note for the user)
so they get their own task under the CLI Security Hardening milestone.

---

## Self-Review notes

- **Spec coverage:** architecture (Task 1+2), command integration (Task 3), denylist + confinement + symlink + unreadable (Tasks 1,2 tests), pre-network rejection (Task 3 test), SKILL.md doc (Task 4), out-of-scope siblings (Task 5 Step 5), testing strategy (all tasks). All spec sections map to a task.
- **Type consistency:** `PathGuardResult` / `checkArtifactFilePath` / `matchSensitiveName` names and the `{ ok, reason, detail, resolved }` shape are identical across the guard module, its tests, and the command integration.
- **No placeholders:** every code/test block is concrete; every run step lists the command and expected outcome.
