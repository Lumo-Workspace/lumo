# lumo worktree Command Group Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `lumo worktree add/rm/list` command group that scaffolds, removes, and lists parallel git worktrees — automating the node_modules symlink and codifying the prisma-clobber and jest-cwd gotchas as printed guidance.

**Architecture:** Pure, unit-testable helpers (id normalization, branch/dir derivation, `git worktree list --porcelain` parsing, worktree lookup) live in `cli/src/lib/worktree.ts`; git invocation uses the `spawnSync('git', …)` pattern already in `cli/src/lib/git-task.ts` (no new dependency). Three thin command modules orchestrate git + filesystem side effects and printing, registered in `cli/src/index.ts` under a `worktree` parent command.

**Tech Stack:** TypeScript (strict), commander, Node `child_process`/`fs`/`path`, Jest (SWC transform), run from `cli/`.

---

## File Structure

- **Create** `cli/src/lib/worktree.ts` — pure helpers + git wrappers (one responsibility: worktree derivation/parsing/git access)
- **Create** `cli/src/commands/worktree-add.ts` — `worktreeAdd()` orchestration
- **Create** `cli/src/commands/worktree-rm.ts` — `worktreeRm()` orchestration
- **Create** `cli/src/commands/worktree-list.ts` — `worktreeList()` orchestration
- **Create** `cli/__tests__/worktree.test.ts` — unit tests for the lib + command control-flow
- **Modify** `cli/src/index.ts` — register the `worktree` command group
- **Modify** `.claude/skills/lumo/SKILL.md` — frontmatter triggers + catalog row + reference pointer
- **Create** `.claude/skills/lumo/references/worktree.md` — command reference
- **Modify** `cli/package.json` — minor version bump

All test commands run with cwd inside the worktree (`cd <worktree>` first) per the jest-cwd gotcha this very feature documents.

---

## Task 1: Pure id/branch/dir helpers

**Files:**
- Create: `cli/src/lib/worktree.ts`
- Test: `cli/__tests__/worktree.test.ts`

- [ ] **Step 1: Write the failing test**

Create `cli/__tests__/worktree.test.ts`:

```ts
import {
  normalizeTaskId,
  slugify,
  deriveBranchName,
  deriveWorktreeDirName,
} from '../src/lib/worktree'

describe('normalizeTaskId', () => {
  it('accepts canonical, bare, and lowercase forms', () => {
    expect(normalizeTaskId('LUM-267')).toBe('LUM-267')
    expect(normalizeTaskId('lum-267')).toBe('LUM-267')
    expect(normalizeTaskId('267')).toBe('LUM-267')
    expect(normalizeTaskId('  LUM-267  ')).toBe('LUM-267')
  })
  it('rejects garbage', () => {
    expect(normalizeTaskId('foo')).toBeNull()
    expect(normalizeTaskId('LUM-')).toBeNull()
    expect(normalizeTaskId('')).toBeNull()
  })
})

describe('slugify', () => {
  it('lowercases and dasherizes', () => {
    expect(slugify('Worktree Scaffold')).toBe('worktree-scaffold')
    expect(slugify('  fix/auth_bug  ')).toBe('fix-auth-bug')
    expect(slugify('---a--b---')).toBe('a-b')
  })
})

describe('deriveBranchName / deriveWorktreeDirName', () => {
  it('includes the slug when given', () => {
    expect(deriveBranchName('LUM-267', 'worktree-scaffold')).toBe(
      'lumo/LUM-267-worktree-scaffold'
    )
    expect(deriveWorktreeDirName('LUM-267', 'worktree-scaffold')).toBe(
      'LUM-267-worktree-scaffold'
    )
  })
  it('falls back to the bare id when no slug', () => {
    expect(deriveBranchName('LUM-267')).toBe('lumo/LUM-267')
    expect(deriveWorktreeDirName('LUM-267')).toBe('LUM-267')
    expect(deriveBranchName('LUM-267', '')).toBe('lumo/LUM-267')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest __tests__/worktree.test.ts -t normalizeTaskId`
Expected: FAIL — `Cannot find module '../src/lib/worktree'`.

- [ ] **Step 3: Write minimal implementation**

Create `cli/src/lib/worktree.ts`:

```ts
/**
 * Normalize a user-supplied task reference to canonical `LUM-<n>` form.
 * Accepts `LUM-267`, `lum-267`, and bare `267`. Returns null for anything
 * that is not a recognizable task id.
 */
export function normalizeTaskId(input: string): string | null {
  const trimmed = input.trim()
  const prefixed = trimmed.match(/^lum-?(\d+)$/i)
  if (prefixed) return `LUM-${prefixed[1]}`
  const bare = trimmed.match(/^(\d+)$/)
  if (bare) return `LUM-${bare[1]}`
  return null
}

/**
 * Turn an arbitrary human slug into a branch/dir-safe segment: lowercase,
 * non-alphanumeric runs collapse to a single dash, leading/trailing dashes
 * stripped.
 */
export function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** `lumo/LUM-267` or `lumo/LUM-267-<slug>`. */
export function deriveBranchName(taskId: string, slug?: string): string {
  const s = slug ? slugify(slug) : ''
  return s ? `lumo/${taskId}-${s}` : `lumo/${taskId}`
}

/** `.worktrees/` dir basename: `LUM-267` or `LUM-267-<slug>`. */
export function deriveWorktreeDirName(taskId: string, slug?: string): string {
  const s = slug ? slugify(slug) : ''
  return s ? `${taskId}-${s}` : taskId
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cli && npx jest __tests__/worktree.test.ts`
Expected: PASS (all three describe blocks).

- [ ] **Step 5: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-267
git add cli/src/lib/worktree.ts cli/__tests__/worktree.test.ts
git commit -m "feat: worktree id/branch/dir helpers [LUM-267]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Porcelain parsing + worktree lookup

**Files:**
- Modify: `cli/src/lib/worktree.ts`
- Test: `cli/__tests__/worktree.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `cli/__tests__/worktree.test.ts`:

```ts
import {
  parseWorktreePorcelain,
  findWorktreeByTaskId,
  type WorktreeEntry,
} from '../src/lib/worktree'

const PORCELAIN = [
  'worktree /repo/main',
  'HEAD aaaa1111',
  'branch refs/heads/lumo/LUM-261-radius',
  '',
  'worktree /repo/main/.worktrees/LUM-256',
  'HEAD bbbb2222',
  'branch refs/heads/lumo/LUM-256-mermaid-diagrams',
  '',
  'worktree /repo/main/.worktrees/detached-one',
  'HEAD cccc3333',
  'detached',
  '',
].join('\n')

describe('parseWorktreePorcelain', () => {
  it('parses path/head/branch and handles detached + trailing record', () => {
    const entries = parseWorktreePorcelain(PORCELAIN)
    expect(entries).toHaveLength(3)
    expect(entries[0]).toEqual({
      path: '/repo/main',
      head: 'aaaa1111',
      branch: 'lumo/LUM-261-radius',
    })
    expect(entries[1].branch).toBe('lumo/LUM-256-mermaid-diagrams')
    expect(entries[2].branch).toBeNull()
  })
  it('parses a final record with no trailing blank line', () => {
    const entries = parseWorktreePorcelain(
      'worktree /repo/main\nHEAD deadbeef\nbranch refs/heads/main'
    )
    expect(entries).toHaveLength(1)
    expect(entries[0].branch).toBe('main')
  })
})

describe('findWorktreeByTaskId', () => {
  const entries: WorktreeEntry[] = [
    { path: '/repo/main', head: 'a', branch: 'lumo/LUM-261-radius' },
    { path: '/repo/main/.worktrees/LUM-256', head: 'b', branch: 'lumo/LUM-256-mermaid-diagrams' },
    { path: '/repo/main/.worktrees/LUM-267', head: 'c', branch: 'lumo/LUM-267' },
  ]
  it('matches by branch prefix', () => {
    expect(findWorktreeByTaskId(entries, 'LUM-256')?.path).toBe(
      '/repo/main/.worktrees/LUM-256'
    )
  })
  it('matches the bare-id branch exactly', () => {
    expect(findWorktreeByTaskId(entries, 'LUM-267')?.path).toBe(
      '/repo/main/.worktrees/LUM-267'
    )
  })
  it('returns null when absent', () => {
    expect(findWorktreeByTaskId(entries, 'LUM-999')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest __tests__/worktree.test.ts -t parseWorktreePorcelain`
Expected: FAIL — `parseWorktreePorcelain is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `cli/src/lib/worktree.ts`:

```ts
import * as path from 'path'

export interface WorktreeEntry {
  path: string
  head: string
  /** Short branch name (no `refs/heads/`), or null when detached. */
  branch: string | null
}

/**
 * Parse `git worktree list --porcelain` output into structured entries.
 * Records are separated by blank lines; a detached worktree has a `detached`
 * line instead of `branch`. Tolerates a final record with no trailing blank.
 */
export function parseWorktreePorcelain(output: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = []
  let cur: { path: string; head: string; branch: string | null } | null = null
  const flush = () => {
    if (cur) entries.push(cur)
    cur = null
  }
  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      flush()
      cur = { path: line.slice('worktree '.length), head: '', branch: null }
    } else if (!cur) {
      continue
    } else if (line.startsWith('HEAD ')) {
      cur.head = line.slice('HEAD '.length)
    } else if (line.startsWith('branch ')) {
      cur.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '')
    } else if (line === '') {
      flush()
    }
  }
  flush()
  return entries
}

/**
 * Find the worktree belonging to a task id. Matches either the branch
 * (`lumo/LUM-267` exactly or `lumo/LUM-267-*`) or the directory basename
 * (`LUM-267` exactly or `LUM-267-*`).
 */
export function findWorktreeByTaskId(
  entries: WorktreeEntry[],
  taskId: string
): WorktreeEntry | null {
  return (
    entries.find(e => {
      const base = path.basename(e.path)
      const branchMatch =
        e.branch === `lumo/${taskId}` ||
        (e.branch?.startsWith(`lumo/${taskId}-`) ?? false)
      const dirMatch = base === taskId || base.startsWith(`${taskId}-`)
      return branchMatch || dirMatch
    }) ?? null
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cli && npx jest __tests__/worktree.test.ts`
Expected: PASS (Task 1 + Task 2 describes).

- [ ] **Step 5: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-267
git add cli/src/lib/worktree.ts cli/__tests__/worktree.test.ts
git commit -m "feat: worktree porcelain parsing + lookup [LUM-267]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: git wrappers + main-checkout detection

**Files:**
- Modify: `cli/src/lib/worktree.ts`
- Test: `cli/__tests__/worktree.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `cli/__tests__/worktree.test.ts`:

```ts
import { spawnSync } from 'child_process'
import { gitOutput, isMainCheckout } from '../src/lib/worktree'

jest.mock('child_process', () => ({ spawnSync: jest.fn() }))
const mockSpawn = spawnSync as jest.MockedFunction<typeof spawnSync>

describe('gitOutput', () => {
  afterEach(() => mockSpawn.mockReset())

  it('returns trimmed stdout on success', () => {
    mockSpawn.mockReturnValue({ status: 0, stdout: '  hello\n', stderr: '' } as never)
    expect(gitOutput(['rev-parse', 'HEAD'])).toBe('hello')
  })

  it('throws with stderr on non-zero exit', () => {
    mockSpawn.mockReturnValue({ status: 128, stdout: '', stderr: 'fatal: nope\n' } as never)
    expect(() => gitOutput(['bad'])).toThrow('fatal: nope')
  })
})

describe('isMainCheckout', () => {
  afterEach(() => mockSpawn.mockReset())

  it('true when git-dir equals common-dir', () => {
    mockSpawn
      .mockReturnValueOnce({ status: 0, stdout: '/repo/.git\n', stderr: '' } as never) // --absolute-git-dir
      .mockReturnValueOnce({ status: 0, stdout: '/repo/.git\n', stderr: '' } as never) // --git-common-dir
    expect(isMainCheckout()).toBe(true)
  })

  it('false inside a linked worktree', () => {
    mockSpawn
      .mockReturnValueOnce({ status: 0, stdout: '/repo/.git/worktrees/LUM-1\n', stderr: '' } as never)
      .mockReturnValueOnce({ status: 0, stdout: '/repo/.git\n', stderr: '' } as never)
    expect(isMainCheckout()).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest __tests__/worktree.test.ts -t gitOutput`
Expected: FAIL — `gitOutput is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `cli/src/lib/worktree.ts` (note: add `spawnSync` import at top, do **not** duplicate the `path` import already added in Task 2):

```ts
import { spawnSync, type SpawnSyncReturns } from 'child_process'

/** Low-level git runner — returns the raw spawn result, never throws on exit. */
export function runGit(
  args: string[],
  cwd?: string
): SpawnSyncReturns<string> {
  return spawnSync('git', args, { cwd, encoding: 'utf8' })
}

/** Run git and return trimmed stdout; throw with stderr on failure. */
export function gitOutput(args: string[], cwd?: string): string {
  const r = runGit(args, cwd)
  if (r.error) throw r.error
  if (r.status !== 0) {
    throw new Error((r.stderr || '').trim() || `git ${args.join(' ')} failed`)
  }
  return (r.stdout ?? '').trim()
}

/** Absolute path to the worktree-local `.git` (file or dir). */
export function getGitDir(cwd?: string): string {
  return gitOutput(['rev-parse', '--absolute-git-dir'], cwd)
}

/** Absolute path to the shared `.git` (same as git-dir in the main checkout). */
export function getGitCommonDir(cwd?: string): string {
  const common = gitOutput(['rev-parse', '--git-common-dir'], cwd)
  return path.resolve(cwd ?? process.cwd(), common)
}

/** True only in the main checkout (git-dir === common-dir). */
export function isMainCheckout(cwd?: string): boolean {
  return getGitDir(cwd) === getGitCommonDir(cwd)
}

/** Absolute repo root of the current working tree. */
export function getRepoRoot(cwd?: string): string {
  return gitOutput(['rev-parse', '--show-toplevel'], cwd)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cli && npx jest __tests__/worktree.test.ts`
Expected: PASS. (The `jest.mock('child_process')` call is hoisted and only affects the gitOutput/isMainCheckout describes; the pure-helper tests don't call spawnSync.)

- [ ] **Step 5: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-267
git add cli/src/lib/worktree.ts cli/__tests__/worktree.test.ts
git commit -m "feat: git wrappers + main-checkout detection [LUM-267]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `worktree add` command

**Files:**
- Create: `cli/src/commands/worktree-add.ts`
- Modify: `cli/src/index.ts`
- Test: `cli/__tests__/worktree-add.test.ts`

- [ ] **Step 1: Write the failing test**

Create `cli/__tests__/worktree-add.test.ts`:

```ts
import * as fs from 'fs'
import { worktreeAdd } from '../src/commands/worktree-add'
import * as wt from '../src/lib/worktree'

jest.mock('../src/lib/worktree', () => {
  const actual = jest.requireActual('../src/lib/worktree')
  return {
    ...actual,
    isMainCheckout: jest.fn(),
    getRepoRoot: jest.fn(),
    runGit: jest.fn(),
  }
})
jest.mock('fs')

const mockFs = fs as jest.Mocked<typeof fs>
const isMain = wt.isMainCheckout as jest.Mock
const repoRoot = wt.getRepoRoot as jest.Mock
const runGit = wt.runGit as jest.Mock

describe('worktreeAdd', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    isMain.mockReturnValue(true)
    repoRoot.mockReturnValue('/repo')
    runGit.mockReturnValue({ status: 0, stdout: '', stderr: '' })
    mockFs.existsSync.mockImplementation((p: fs.PathLike) =>
      String(p).endsWith('node_modules')
    )
    mockFs.mkdirSync.mockReturnValue(undefined as never)
    mockFs.symlinkSync.mockReturnValue(undefined as never)
  })

  it('rejects an unparseable id', async () => {
    expect(await worktreeAdd('garbage', undefined, {})).toBe(1)
    expect(runGit).not.toHaveBeenCalled()
  })

  it('refuses when not on the main checkout', async () => {
    isMain.mockReturnValue(false)
    expect(await worktreeAdd('LUM-267', undefined, {})).toBe(1)
  })

  it('errors when the target dir already exists', async () => {
    mockFs.existsSync.mockReturnValue(true) // dir + node_modules both "exist"
    expect(await worktreeAdd('LUM-267', 'scaffold', {})).toBe(1)
  })

  it('creates the worktree off origin/main and symlinks node_modules', async () => {
    // rev-parse --verify (branch missing) → status 1; everything else → 0
    runGit.mockImplementation((args: string[]) =>
      args[0] === 'rev-parse'
        ? { status: 1, stdout: '', stderr: '' }
        : { status: 0, stdout: '', stderr: '' }
    )
    expect(await worktreeAdd('267', 'scaffold', {})).toBe(0)

    const calls = runGit.mock.calls.map(c => c[0])
    expect(calls).toContainEqual(['fetch', 'origin', 'main'])
    expect(calls).toContainEqual([
      'worktree',
      'add',
      '/repo/.worktrees/LUM-267-scaffold',
      '-b',
      'lumo/LUM-267-scaffold',
      'origin/main',
    ])
    expect(mockFs.symlinkSync).toHaveBeenCalledWith(
      '/repo/node_modules',
      '/repo/.worktrees/LUM-267-scaffold/node_modules'
    )
  })

  it('reuses an existing branch (no -b) and skips fetch with --no-fetch', async () => {
    runGit.mockReturnValue({ status: 0, stdout: '', stderr: '' }) // rev-parse → 0 = branch exists
    expect(await worktreeAdd('LUM-267', undefined, { noFetch: true })).toBe(0)

    const calls = runGit.mock.calls.map(c => c[0])
    expect(calls).not.toContainEqual(['fetch', 'origin', 'main'])
    expect(calls).toContainEqual([
      'worktree',
      'add',
      '/repo/.worktrees/LUM-267',
      'lumo/LUM-267',
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest __tests__/worktree-add.test.ts`
Expected: FAIL — `Cannot find module '../src/commands/worktree-add'`.

- [ ] **Step 3: Write minimal implementation**

Create `cli/src/commands/worktree-add.ts`:

```ts
import * as fs from 'fs'
import * as path from 'path'
import { spawnSync } from 'child_process'
import {
  normalizeTaskId,
  deriveBranchName,
  deriveWorktreeDirName,
  isMainCheckout,
  getRepoRoot,
  runGit,
} from '../lib/worktree'

export interface WorktreeAddOptions {
  base?: string
  noFetch?: boolean
  verify?: boolean
}

function printGuidance(dir: string, branch: string): void {
  console.log('')
  console.log(`✓ Worktree ready: ${dir}`)
  console.log(`  branch:        ${branch}`)
  console.log(`  node_modules:  symlinked to main checkout`)
  console.log('')
  console.log('Next:')
  console.log(`  cd ${dir}`)
  console.log('')
  console.log('Gotchas baked into this worktree:')
  console.log(
    '  • prisma: the generated client is SHARED via the node_modules symlink.'
  )
  console.log(
    "          Don't run `prisma generate` mid-work across parallel worktrees;"
  )
  console.log(
    '          verify with jest, and do generate+tsc atomically once at the end.'
  )
  console.log(
    '  • jest:   always run it from INSIDE this worktree (cd first), or the'
  )
  console.log(
    '          cli/package.json haste collision silently runs the wrong tests.'
  )
}

export async function worktreeAdd(
  rawId: string,
  slug: string | undefined,
  opts: WorktreeAddOptions
): Promise<number> {
  const taskId = normalizeTaskId(rawId)
  if (!taskId) {
    console.error(`Error: "${rawId}" is not a task id (expected LUM-N or N)`)
    return 1
  }
  if (!isMainCheckout()) {
    console.error(
      'Error: run `lumo worktree add` from the main checkout, not inside a worktree'
    )
    return 1
  }

  const root = getRepoRoot()
  const branch = deriveBranchName(taskId, slug)
  const dir = path.join(root, '.worktrees', deriveWorktreeDirName(taskId, slug))

  if (fs.existsSync(dir)) {
    console.error(
      `Error: ${dir} already exists — remove it first or pick a different slug`
    )
    return 1
  }
  fs.mkdirSync(path.dirname(dir), { recursive: true })

  const base = opts.base ?? 'origin/main'
  if (!opts.noFetch && !opts.base) {
    console.log('Fetching origin/main …')
    if (runGit(['fetch', 'origin', 'main'], root).status !== 0) {
      console.error(`Warning: git fetch failed; branching off local ${base}`)
    }
  }

  const branchExists =
    runGit(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], root)
      .status === 0
  const addArgs = branchExists
    ? ['worktree', 'add', dir, branch]
    : ['worktree', 'add', dir, '-b', branch, base]
  const added = runGit(addArgs, root)
  if (added.status !== 0) {
    console.error(
      `Error: ${(added.stderr || '').trim() || 'git worktree add failed'}`
    )
    return 1
  }

  const srcModules = path.join(root, 'node_modules')
  if (fs.existsSync(srcModules)) {
    fs.symlinkSync(srcModules, path.join(dir, 'node_modules'))
  } else {
    console.log(
      'Warning: main checkout has no node_modules; run `npm install` there, then symlink manually'
    )
  }

  printGuidance(dir, branch)

  if (opts.verify) {
    console.log('Running baseline jest …')
    const j = spawnSync('npx', ['jest'], { cwd: dir, stdio: 'inherit' })
    if (j.status !== 0) {
      console.error('Warning: baseline jest did not pass cleanly')
    }
  }

  return 0
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-267 && npx jest cli/__tests__/worktree-add.test.ts`
Expected: PASS (5 tests). (Run jest from the worktree ROOT, not `cd cli` — `cli/` has no jest config; the root next/jest+SWC config is the one that transpiles TS.)

- [ ] **Step 5: Register the command in `cli/src/index.ts`**

Add the import alongside the other command imports (near line 82, after `import { setup } from './commands/setup'`):

```ts
import { worktreeAdd } from './commands/worktree-add'
import { worktreeRm } from './commands/worktree-rm'
import { worktreeList } from './commands/worktree-list'
```

Add the command registration just before the `hook` command block (before the `const hook = program.command('hook')` line near line 1195):

```ts
const worktree = program
  .command('worktree')
  .description(
    'Scaffold, remove, and list parallel git worktrees under .worktrees/ (node_modules symlink + prisma/jest gotcha guidance). Local dev tooling; run from the main checkout.'
  )

worktree
  .command('add <identifier> [slug]')
  .description(
    'Create a worktree at .worktrees/<LUM-N>[-slug] on branch lumo/<LUM-N>[-slug] off origin/main, symlink node_modules to the main checkout, and print prisma/jest guidance. Run from the main checkout.'
  )
  .option('--base <ref>', 'Branch off this ref instead of origin/main (skips fetch)')
  .option('--no-fetch', 'Do not `git fetch origin main` before branching')
  .option('--verify', 'Run `npx jest` in the new worktree to confirm a clean baseline')
  .action(
    wrap((identifier, slug, options) =>
      worktreeAdd(
        identifier as string,
        slug as string | undefined,
        options as { base?: string; noFetch?: boolean; verify?: boolean }
      )
    )
  )
```

(Note: commander maps `--no-fetch` to `options.fetch === false`; the action passes the whole options object, and `worktreeAdd` reads `opts.noFetch`. To keep the option name explicit, register it as `--no-fetch` but read `options.fetch` — adjust the wrap to translate: `{ ...options, noFetch: options.fetch === false }`. Use this exact wrap instead:)

```ts
  .action(
    wrap((identifier, slug, options) => {
      const o = options as { base?: string; fetch?: boolean; verify?: boolean }
      return worktreeAdd(identifier as string, slug as string | undefined, {
        base: o.base,
        noFetch: o.fetch === false,
        verify: o.verify,
      })
    })
  )
```

- [ ] **Step 6: Verify it compiles and the command is wired**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-267 && npx tsc --noEmit`
Expected: tsc clean for the files you touched (`cli/src/commands/worktree-add.ts`, `cli/src/index.ts`). tsc checks the whole repo; ignore unrelated errors from parallel work / a stale prisma client.

- [ ] **Step 7: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-267
git add cli/src/commands/worktree-add.ts cli/__tests__/worktree-add.test.ts cli/src/index.ts
git commit -m "feat: lumo worktree add command [LUM-267]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `worktree rm` command

**Files:**
- Create: `cli/src/commands/worktree-rm.ts`
- Modify: `cli/src/index.ts`
- Test: `cli/__tests__/worktree-rm.test.ts`

- [ ] **Step 1: Write the failing test**

Create `cli/__tests__/worktree-rm.test.ts`:

```ts
import { worktreeRm } from '../src/commands/worktree-rm'
import * as wt from '../src/lib/worktree'

jest.mock('../src/lib/worktree', () => {
  const actual = jest.requireActual('../src/lib/worktree')
  return {
    ...actual,
    isMainCheckout: jest.fn(),
    getRepoRoot: jest.fn(),
    gitOutput: jest.fn(),
    runGit: jest.fn(),
  }
})

const isMain = wt.isMainCheckout as jest.Mock
const repoRoot = wt.getRepoRoot as jest.Mock
const gitOutput = wt.gitOutput as jest.Mock
const runGit = wt.runGit as jest.Mock

const LIST = [
  'worktree /repo',
  'HEAD a',
  'branch refs/heads/lumo/LUM-261',
  '',
  'worktree /repo/.worktrees/LUM-267-scaffold',
  'HEAD b',
  'branch refs/heads/lumo/LUM-267-scaffold',
  '',
].join('\n')

describe('worktreeRm', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    isMain.mockReturnValue(true)
    repoRoot.mockReturnValue('/repo')
    runGit.mockReturnValue({ status: 0, stdout: '', stderr: '' })
    // 1st gitOutput call = worktree list; later calls = status --porcelain (clean)
    gitOutput.mockImplementation((args: string[]) =>
      args[0] === 'worktree' ? LIST : ''
    )
  })

  it('refuses without --yes', async () => {
    expect(await worktreeRm('LUM-267', {})).toBe(1)
    expect(runGit).not.toHaveBeenCalledWith(
      expect.arrayContaining(['worktree', 'remove']),
      expect.anything()
    )
  })

  it('errors when no worktree matches', async () => {
    expect(await worktreeRm('LUM-999', { yes: true })).toBe(1)
  })

  it('removes a clean worktree and keeps the branch by default', async () => {
    expect(await worktreeRm('267', { yes: true })).toBe(0)
    const calls = runGit.mock.calls.map(c => c[0])
    expect(calls).toContainEqual([
      'worktree',
      'remove',
      '/repo/.worktrees/LUM-267-scaffold',
    ])
    expect(calls).not.toContainEqual(
      expect.arrayContaining(['branch', '-d'])
    )
  })

  it('refuses a dirty worktree without --force, removes with --force', async () => {
    gitOutput.mockImplementation((args: string[]) =>
      args[0] === 'worktree' ? LIST : ' M file.ts'
    )
    expect(await worktreeRm('LUM-267', { yes: true })).toBe(1)

    jest.clearAllMocks()
    isMain.mockReturnValue(true)
    repoRoot.mockReturnValue('/repo')
    runGit.mockReturnValue({ status: 0, stdout: '', stderr: '' })
    gitOutput.mockImplementation((args: string[]) =>
      args[0] === 'worktree' ? LIST : ' M file.ts'
    )
    expect(await worktreeRm('LUM-267', { yes: true, force: true })).toBe(0)
    expect(runGit.mock.calls.map(c => c[0])).toContainEqual([
      'worktree',
      'remove',
      '--force',
      '/repo/.worktrees/LUM-267-scaffold',
    ])
  })

  it('deletes the branch with --delete-branch', async () => {
    expect(
      await worktreeRm('LUM-267', { yes: true, deleteBranch: true })
    ).toBe(0)
    expect(runGit.mock.calls.map(c => c[0])).toContainEqual([
      'branch',
      '-d',
      'lumo/LUM-267-scaffold',
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest __tests__/worktree-rm.test.ts`
Expected: FAIL — `Cannot find module '../src/commands/worktree-rm'`.

- [ ] **Step 3: Write minimal implementation**

Create `cli/src/commands/worktree-rm.ts`:

```ts
import {
  normalizeTaskId,
  isMainCheckout,
  getRepoRoot,
  gitOutput,
  runGit,
  parseWorktreePorcelain,
  findWorktreeByTaskId,
} from '../lib/worktree'

export interface WorktreeRmOptions {
  yes?: boolean
  force?: boolean
  deleteBranch?: boolean
}

export async function worktreeRm(
  rawId: string,
  opts: WorktreeRmOptions
): Promise<number> {
  const taskId = normalizeTaskId(rawId)
  if (!taskId) {
    console.error(`Error: "${rawId}" is not a task id (expected LUM-N or N)`)
    return 1
  }
  if (!isMainCheckout()) {
    console.error(
      'Error: run `lumo worktree rm` from the main checkout, not inside a worktree'
    )
    return 1
  }

  const root = getRepoRoot()
  const entries = parseWorktreePorcelain(
    gitOutput(['worktree', 'list', '--porcelain'], root)
  )
  const target = findWorktreeByTaskId(entries, taskId)
  if (!target) {
    console.error(`Error: no worktree found for ${taskId}`)
    return 1
  }
  if (!opts.yes) {
    console.error(
      `Error: refusing to remove ${target.path} without --yes (destructive)`
    )
    return 1
  }

  const dirty = gitOutput(['status', '--porcelain'], target.path).length > 0
  if (dirty && !opts.force) {
    console.error(
      `Error: ${target.path} has uncommitted changes — pass --force to remove anyway`
    )
    return 1
  }

  const removeArgs =
    dirty && opts.force
      ? ['worktree', 'remove', '--force', target.path]
      : ['worktree', 'remove', target.path]
  const removed = runGit(removeArgs, root)
  if (removed.status !== 0) {
    console.error(
      `Error: ${(removed.stderr || '').trim() || 'git worktree remove failed'}`
    )
    return 1
  }
  console.log(`✓ Removed worktree ${target.path}`)

  if (opts.deleteBranch && target.branch) {
    const del = runGit(['branch', '-d', target.branch], root)
    if (del.status !== 0) {
      console.error(
        `Warning: could not delete branch ${target.branch}: ${(del.stderr || '').trim()}`
      )
    } else {
      console.log(`✓ Deleted branch ${target.branch}`)
    }
  } else if (target.branch) {
    console.log(
      `  branch ${target.branch} kept (use --delete-branch to remove)`
    )
  }

  return 0
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-267 && npx jest cli/__tests__/worktree-rm.test.ts`
Expected: PASS (5 tests). (Run jest from the worktree ROOT, not `cd cli`.)

- [ ] **Step 5: Register in `cli/src/index.ts`**

Add after the `worktree add` registration from Task 4:

```ts
worktree
  .command('rm <identifier>')
  .description(
    'Remove the worktree for a task (git worktree remove). Requires --yes. Refuses a dirty worktree unless --force. Keeps the branch unless --delete-branch.'
  )
  .option('--yes', 'Confirm removal (required, no interactive prompt)')
  .option('--force', 'Remove even with uncommitted changes')
  .option('--delete-branch', 'Also delete the branch (git branch -d; refuses if unmerged)')
  .action(
    wrap((identifier, options) =>
      worktreeRm(
        identifier as string,
        options as { yes?: boolean; force?: boolean; deleteBranch?: boolean }
      )
    )
  )
```

- [ ] **Step 6: Verify compiles**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-267 && npx tsc --noEmit`
Expected: clean for the files you touched (ignore unrelated whole-repo errors).

- [ ] **Step 7: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-267
git add cli/src/commands/worktree-rm.ts cli/__tests__/worktree-rm.test.ts cli/src/index.ts
git commit -m "feat: lumo worktree rm command [LUM-267]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: `worktree list` command

**Files:**
- Create: `cli/src/commands/worktree-list.ts`
- Modify: `cli/src/index.ts`
- Test: `cli/__tests__/worktree-list.test.ts`

- [ ] **Step 1: Write the failing test**

Create `cli/__tests__/worktree-list.test.ts`:

```ts
import * as fs from 'fs'
import { worktreeList } from '../src/commands/worktree-list'
import * as wt from '../src/lib/worktree'

jest.mock('../src/lib/worktree', () => {
  const actual = jest.requireActual('../src/lib/worktree')
  return { ...actual, getGitCommonDir: jest.fn(), gitOutput: jest.fn() }
})
jest.mock('fs')

const mockFs = fs as jest.Mocked<typeof fs>
const commonDir = wt.getGitCommonDir as jest.Mock
const gitOutput = wt.gitOutput as jest.Mock

const LIST = [
  'worktree /repo',
  'HEAD a',
  'branch refs/heads/lumo/LUM-261',
  '',
  'worktree /repo/.worktrees/LUM-267-scaffold',
  'HEAD b',
  'branch refs/heads/lumo/LUM-267-scaffold',
  '',
].join('\n')

describe('worktreeList', () => {
  let logSpy: jest.SpyInstance
  beforeEach(() => {
    jest.clearAllMocks()
    commonDir.mockReturnValue('/repo/.git')
    gitOutput.mockImplementation((args: string[]) =>
      args[0] === 'worktree' ? LIST : ''
    )
    mockFs.lstatSync.mockReturnValue({ isSymbolicLink: () => true } as never)
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
  })
  afterEach(() => logSpy.mockRestore())

  it('lists only worktrees under .worktrees/ and shows the task id', async () => {
    expect(await worktreeList()).toBe(0)
    const printed = logSpy.mock.calls.map(c => String(c[0])).join('\n')
    expect(printed).toContain('LUM-267')
    expect(printed).toContain('/repo/.worktrees/LUM-267-scaffold')
    expect(printed).not.toContain('lumo/LUM-261') // the main checkout is excluded
  })

  it('prints an empty notice when none exist', async () => {
    gitOutput.mockImplementation((args: string[]) =>
      args[0] === 'worktree'
        ? 'worktree /repo\nHEAD a\nbranch refs/heads/main\n'
        : ''
    )
    expect(await worktreeList()).toBe(0)
    expect(logSpy.mock.calls.map(c => String(c[0])).join('\n')).toContain(
      'no worktrees'
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest __tests__/worktree-list.test.ts`
Expected: FAIL — `Cannot find module '../src/commands/worktree-list'`.

- [ ] **Step 3: Write minimal implementation**

Create `cli/src/commands/worktree-list.ts`:

```ts
import * as fs from 'fs'
import * as path from 'path'
import {
  getGitCommonDir,
  gitOutput,
  parseWorktreePorcelain,
  normalizeTaskId,
} from '../lib/worktree'

function nodeModulesLinked(dir: string): boolean {
  try {
    return fs.lstatSync(path.join(dir, 'node_modules')).isSymbolicLink()
  } catch {
    return false
  }
}

/** Pull a LUM-N from a worktree dir basename or its branch, else '—'. */
function taskIdOf(dirBase: string, branch: string | null): string {
  return (
    normalizeTaskId(dirBase.replace(/-.*$/, '')) ??
    (branch ? normalizeTaskId(branch.replace(/^lumo\//, '').replace(/-.*$/, '')) : null) ??
    '—'
  )
}

export async function worktreeList(): Promise<number> {
  const mainRoot = path.dirname(getGitCommonDir())
  const worktreesDir = path.join(mainRoot, '.worktrees')
  const entries = parseWorktreePorcelain(
    gitOutput(['worktree', 'list', '--porcelain'], mainRoot)
  ).filter(e => e.path.startsWith(worktreesDir + path.sep))

  if (entries.length === 0) {
    console.log('(no worktrees under .worktrees/)')
    return 0
  }

  for (const e of entries) {
    const base = path.basename(e.path)
    const id = taskIdOf(base, e.branch)
    const dirty =
      gitOutput(['status', '--porcelain'], e.path).length > 0
        ? 'dirty'
        : 'clean'
    const nm = nodeModulesLinked(e.path) ? 'linked' : 'MISSING'
    console.log(
      `${id}\t${e.branch ?? '(detached)'}\t${dirty}\tnode_modules:${nm}\t${e.path}`
    )
  }
  return 0
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-267 && npx jest cli/__tests__/worktree-list.test.ts`
Expected: PASS (2 tests). (Run jest from the worktree ROOT, not `cd cli`.)

- [ ] **Step 5: Register in `cli/src/index.ts`**

Add after the `worktree rm` registration:

```ts
worktree
  .command('list')
  .description(
    'List worktrees under .worktrees/: task id, branch, dirty state, and whether node_modules is symlinked.'
  )
  .action(wrap(() => worktreeList()))
```

- [ ] **Step 6: Verify compiles + full CLI test suite green**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-267 && npx tsc --noEmit && npx jest cli/__tests__/worktree.test.ts cli/__tests__/worktree-add.test.ts cli/__tests__/worktree-rm.test.ts cli/__tests__/worktree-list.test.ts`
Expected: tsc clean (for touched files); all four worktree jest suites pass. (Run jest from the worktree ROOT.)

- [ ] **Step 7: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-267
git add cli/src/commands/worktree-list.ts cli/__tests__/worktree-list.test.ts cli/src/index.ts
git commit -m "feat: lumo worktree list command [LUM-267]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Docs sync (SKILL.md + reference)

**Files:**
- Create: `.claude/skills/lumo/references/worktree.md`
- Modify: `.claude/skills/lumo/SKILL.md`

- [ ] **Step 1: Create the reference file**

Create `.claude/skills/lumo/references/worktree.md`:

````markdown
# Worktrees

Local dev tooling that scaffolds parallel git worktrees. Unlike every other
`lumo` command, these do **not** touch the Lumo server — they shell out to git
and the local filesystem. **Run them from the main checkout**, not from inside a
worktree (the node_modules symlink source and `.worktrees/` both live there).

## `lumo worktree add <LUM-N> [slug]`

Creates `.worktrees/<LUM-N>[-slug]` on branch `lumo/<LUM-N>[-slug]`, branched off
`origin/main` (after a fetch), and symlinks its `node_modules` to the main
checkout so jest/tsc work immediately. With no slug, the dir and branch use the
bare `LUM-N` form. Prints next-step guidance plus the two gotchas it can't fix
for you (shared prisma client, jest cwd).

```bash
lumo worktree add LUM-267 worktree-scaffold   # → .worktrees/LUM-267-worktree-scaffold
lumo worktree add LUM-267                      # → .worktrees/LUM-267
lumo worktree add LUM-267 --base main          # branch off local main, skip fetch
lumo worktree add LUM-267 --no-fetch           # branch off existing origin/main
lumo worktree add LUM-267 --verify             # run npx jest baseline after setup
```

Flags: `--base <ref>` (branch off a ref other than origin/main; skips the
fetch), `--no-fetch` (skip `git fetch origin main`), `--verify` (run `npx jest`
in the new worktree). Errors if the target dir already exists; reuses the branch
if it already exists (no `-b`).

**The prisma gotcha it warns about:** the generated client lives in the shared
(symlinked) `node_modules`, so a `prisma generate` in one worktree clobbers the
client every parallel worktree depends on. Verify with jest (SWC mocks Prisma);
do `generate + tsc` atomically once at the end.

**The jest gotcha it warns about:** always run jest from inside the worktree
(`cd` first) or the `cli/package.json` haste collision silently runs the main
tree's tests.

## `lumo worktree rm <LUM-N>`

Removes the worktree for a task. Requires `--yes`. Refuses a dirty worktree
unless `--force`. Keeps the branch by default (it may hold unpushed work / an
open PR); `--delete-branch` removes it with `git branch -d` (which itself
refuses an unmerged branch).

```bash
lumo worktree rm LUM-267 --yes
lumo worktree rm LUM-267 --yes --force            # discard uncommitted changes
lumo worktree rm LUM-267 --yes --delete-branch    # also delete lumo/LUM-267…
```

## `lumo worktree list`

Lists worktrees under `.worktrees/` with task id, branch, dirty state, and
whether `node_modules` is symlinked (a `MISSING` link is the first thing to
check when jest/tsc misbehaves). Read-only; runnable from anywhere in the repo.

```bash
lumo worktree list
```
````

- [ ] **Step 2: Add trigger words to `SKILL.md` frontmatter**

In `.claude/skills/lumo/SKILL.md`, find the frontmatter `description:` line and append worktree triggers to the existing trigger list (keep it one line, before the closing quote): add `, "worktree", "git worktree", "并行 worktree", "scaffold worktree", "新建 worktree", "node_modules 软链", "worktree 隔离"`.

- [ ] **Step 3: Add the catalog row + table pointer**

In `SKILL.md`, add a row to the domain→reference table:

```markdown
| `worktree add/rm/list`                                                            | [references/worktree.md](references/worktree.md)               |
```

And add a catalog section after the Sessions block:

```markdown
**Worktrees (local dev tooling)** — see [worktree.md](references/worktree.md)

- `lumo worktree add <LUM-N> [slug]` — scaffold `.worktrees/<LUM-N>` + node_modules symlink off origin/main
- `lumo worktree rm <LUM-N> --yes` — remove a worktree (kept branch unless `--delete-branch`)
- `lumo worktree list` — list `.worktrees/` worktrees (branch, dirty, node_modules link)
```

- [ ] **Step 4: Verify the docs reference matches real flags**

Run: `cd cli && npx tsc --noEmit` (sanity) and manually diff the flag names in
`worktree.md` / SKILL.md against `cli/src/index.ts` worktree registration.
Expected: `--base`, `--no-fetch`, `--verify`, `--yes`, `--force`, `--delete-branch`
all match.

- [ ] **Step 5: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-267
git add .claude/skills/lumo/references/worktree.md .claude/skills/lumo/SKILL.md
git commit -m "docs: document lumo worktree command group in SKILL.md [LUM-267]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Version bump + atomic final verification

**Files:**
- Modify: `cli/package.json`

- [ ] **Step 1: Bump the CLI minor version**

Edit `cli/package.json`: change `"version": "1.17.0"` to `"version": "1.18.0"` (feat → minor).

- [ ] **Step 2: Atomic generate + tsc + full jest (per the prisma-clobber memory)**

Because node_modules is symlinked, run prisma generate, tsc, and jest together
once, with cwd inside the worktree, so the shared client matches this branch for
the duration of the check:

Run:
```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-267
npx prisma generate && npx tsc --noEmit && npx jest cli/__tests__/worktree.test.ts cli/__tests__/worktree-add.test.ts cli/__tests__/worktree-rm.test.ts cli/__tests__/worktree-list.test.ts
```
Expected: prisma generate succeeds; root `tsc --noEmit` clean; all four worktree
jest suites pass. Run jest from the worktree ROOT (not `cd cli` — `cli/` has no
jest config). If `tsc` reports columns from another branch, a parallel worktree
re-ran `prisma generate` — re-run this atomic block.

- [ ] **Step 3: Confirm no console.log lint / forbidden patterns**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-267 && grep -rn "console.log" cli/src/commands/worktree-*.ts`
Expected: matches ARE present and intentional — these are CLI user-facing output
(the whole `cli/` surface prints via `console.log`, consistent with the other
command modules; the "no console.log" rule targets the Next.js app, not the
CLI). No action needed; this step just documents the intentional exception.

- [ ] **Step 4: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-267
git add cli/package.json
git commit -m "chore: bump @lumoai/cli to 1.18.0 for worktree command [LUM-267]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 5: Push + open PR (do not merge)**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-267
git push -u origin lumo/LUM-267-worktree-scaffold
gh pr create --title "feat: lumo worktree scaffold command (add/rm/list) [LUM-267]" --body "$(cat <<'EOF'
## Summary
Adds a `lumo worktree add/rm/list` command group that scaffolds parallel git worktrees: creates the worktree off origin/main, symlinks node_modules to the main checkout, and prints the prisma-clobber and jest-cwd gotchas as guidance. Removes and lists `.worktrees/` worktrees too.

## Notes
- **New dev-tooling command** (local; does not touch the Lumo server).
- `cli/package.json` bumped 1.17.0 → 1.18.0 — **requires a manual `cd cli && npm publish`** after merge; `lumo update` only delivers published versions.
- No new npm packages, no schema/migration changes.
- `.claude/skills/lumo/SKILL.md` + `references/worktree.md` updated per the CLI&Skills sync rule.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Command surface add/rm/list → Tasks 4/5/6 ✓
- `add`: main-checkout guard, id normalize, branch/dir derive, dir-exists error, fetch+origin/main, branch-reuse, node_modules symlink, guidance, `--verify` → Task 4 ✓
- `rm`: lookup by LUM-N, `--yes`, dirty/`--force`, keep-branch default, `--delete-branch` → Task 5 ✓
- `list`: porcelain filter to `.worktrees/`, node_modules-link column → Task 6 ✓
- Code structure (lib + 3 command modules + index registration) → Tasks 1-6 ✓
- Testing (unit on helpers + command control-flow) → Tasks 1-6 ✓
- Docs sync (SKILL.md + references/worktree.md) → Task 7 ✓
- Version bump + publish note → Task 8 ✓
- prisma non-goal (guidance only) → Task 4 printGuidance + Task 8 atomic check ✓

**Placeholder scan:** No TBD/TODO; every code step has full code. ✓

**Type consistency:** `WorktreeEntry {path, head, branch|null}` used identically in Tasks 2/5/6. Helper names (`normalizeTaskId`, `deriveBranchName`, `deriveWorktreeDirName`, `parseWorktreePorcelain`, `findWorktreeByTaskId`, `runGit`, `gitOutput`, `getGitCommonDir`, `getRepoRoot`, `isMainCheckout`) consistent across command modules and tests. Option interfaces (`WorktreeAddOptions`, `WorktreeRmOptions`) match the index.ts wrap casts. ✓
