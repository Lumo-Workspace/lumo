# commit-msg Task ID Hook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `lumo setup` installs an idempotent `prepare-commit-msg` git hook that auto-appends the branch's `[LUM-N]` tag to any commit subject that lacks it.

**Architecture:** A pure-POSIX-sh hook block (no `lumo`/network dependency) extracts `LUM-N` from the current branch name and appends it to the commit subject. A new pure-function module `cli/src/lib/git-hook-template.ts` owns the script block plus idempotent file-merge and install-mode decision logic. `setup.ts` gains an `installGitHook` step (project scope only) that writes the hook into the resolved hooks dir, or — when `core.hooksPath` is set (husky/custom) — degrades to printing manual instructions.

**Tech Stack:** TypeScript (CLI), Node `fs`/`child_process`, POSIX sh + git (hook), Jest (`__tests__/cli/`, `@jest-environment node`).

---

## File Structure

- **Create** `cli/src/lib/git-hook-template.ts` — script-block constant + marker constants; `mergeGitHook()` (idempotent string merge); `resolveHookInstall()` (install vs degrade).
- **Modify** `cli/src/commands/setup.ts` — add `installGitHook()` + `printGitHookManualInstructions()`; call from `setup()` only when scope is `project`.
- **Create** `__tests__/cli/git-hook-template.test.ts` — unit tests for `mergeGitHook` + `resolveHookInstall`.
- **Create** `__tests__/cli/prepare-commit-msg-script.test.ts` — integration test running the real script block via `sh` against a temp git repo.
- **Modify** `.claude/skills/lumo/SKILL.md` — document the new git-hook install behavior in the setup section.
- **Modify** `cli/package.json` — minor version bump.

> **Worktree note:** This repo uses worktree-per-task. If executing in a fresh `.worktrees/<id>`, symlink `node_modules` to the main checkout before running jest/tsc (see project memory). All commands below assume cwd = repo root.

---

### Task 1: `git-hook-template.ts` — pure functions

**Files:**

- Create: `cli/src/lib/git-hook-template.ts`
- Test: `__tests__/cli/git-hook-template.test.ts`

- [ ] **Step 1: Write the failing unit test**

Create `__tests__/cli/git-hook-template.test.ts`:

```ts
/**
 * @jest-environment node
 */
import {
  HOOK_SCRIPT_BLOCK,
  LUMO_HOOK_BEGIN,
  LUMO_HOOK_END,
  mergeGitHook,
  resolveHookInstall,
} from '@/cli/src/lib/git-hook-template'

describe('mergeGitHook', () => {
  it('creates a fresh hook with shebang when none exists', () => {
    const { content, status } = mergeGitHook(null)
    expect(status).toBe('created')
    expect(content.startsWith('#!/bin/sh\n')).toBe(true)
    expect(content).toContain(LUMO_HOOK_BEGIN)
    expect(content).toContain(LUMO_HOOK_END)
  })

  it('treats a blank/whitespace-only file as empty (created)', () => {
    expect(mergeGitHook('   \n').status).toBe('created')
  })

  it('appends the block to a foreign hook, preserving existing content', () => {
    const existing = '#!/bin/sh\necho "my custom hook"\n'
    const { content, status } = mergeGitHook(existing)
    expect(status).toBe('appended')
    expect(content).toContain('echo "my custom hook"')
    expect(content).toContain(LUMO_HOOK_BEGIN)
  })

  it('reports unchanged when our block is already present and identical', () => {
    const first = mergeGitHook(null).content
    const { status } = mergeGitHook(first)
    expect(status).toBe('unchanged')
  })

  it('replaces a stale managed block in place (updated)', () => {
    const stale = `#!/bin/sh\n${LUMO_HOOK_BEGIN}\nold_logic_here\n${LUMO_HOOK_END}\n`
    const { content, status } = mergeGitHook(stale)
    expect(status).toBe('updated')
    expect(content).not.toContain('old_logic_here')
    expect(content).toContain(HOOK_SCRIPT_BLOCK)
  })
})

describe('resolveHookInstall', () => {
  it('installs when core.hooksPath is unset', () => {
    expect(resolveHookInstall(null)).toEqual({ mode: 'install' })
  })

  it('degrades when core.hooksPath is set (husky/custom)', () => {
    expect(resolveHookInstall('.husky/_')).toEqual({ mode: 'degrade' })
  })

  it('treats a whitespace-only hooksPath as unset', () => {
    expect(resolveHookInstall('  ')).toEqual({ mode: 'install' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/cli/git-hook-template.test.ts`
Expected: FAIL — `Cannot find module '@/cli/src/lib/git-hook-template'`.

- [ ] **Step 3: Implement `cli/src/lib/git-hook-template.ts`**

```ts
// Idempotent install + content management for the Lumo `prepare-commit-msg`
// git hook. The hook block itself is pure POSIX sh + git — it extracts the
// `LUM-N` tag from the current branch name and appends it to the commit
// subject, with NO dependency on the `lumo` binary or any network call.

/** Markers delimiting the Lumo-managed block inside a prepare-commit-msg file. */
export const LUMO_HOOK_BEGIN = '# >>> lumo prepare-commit-msg >>>'
export const LUMO_HOOK_END = '# <<< lumo <<<'

const SHEBANG = '#!/bin/sh'

// The managed block. `$1` = commit-message file, `$2` = message source
// (message|template|merge|squash|commit). awk is POSIX-required and present
// wherever git runs. The grep guard makes the hook a no-op when the message
// already carries any [LUM-x] tag.
export const HOOK_SCRIPT_BLOCK = `${LUMO_HOOK_BEGIN}
# Auto-append the branch's task ID ([LUM-N]) to the commit subject when absent.
# Managed by \`lumo setup\` — edit between the markers at your own risk.
case "$2" in
  merge|squash) exit 0 ;;
esac
lumo_branch=$(git symbolic-ref --short HEAD 2>/dev/null) || exit 0
lumo_id=$(printf '%s' "$lumo_branch" | grep -oE 'LUM-[0-9]+' | head -n1)
[ -z "$lumo_id" ] && exit 0
grep -qE '\\[LUM-[0-9]+\\]' "$1" && exit 0
lumo_tmp="$1.lumo.tmp"
awk -v id="$lumo_id" '
  !done && $0 !~ /^#/ && $0 !~ /^[[:space:]]*$/ { $0 = $0 " [" id "]"; done = 1 }
  { print }
' "$1" > "$lumo_tmp" && mv "$lumo_tmp" "$1"
${LUMO_HOOK_END}`

export type MergeGitHookStatus =
  | 'created'
  | 'updated'
  | 'unchanged'
  | 'appended'

/**
 * Idempotently fold the Lumo block into an existing prepare-commit-msg file.
 * - null/blank existing      → fresh file with shebang + block ('created')
 * - existing has our markers  → replace block in place ('updated' / 'unchanged')
 * - existing foreign content  → preserve it, append our block ('appended')
 */
export function mergeGitHook(existing: string | null): {
  content: string
  status: MergeGitHookStatus
} {
  if (existing === null || existing.trim() === '') {
    return { content: `${SHEBANG}\n${HOOK_SCRIPT_BLOCK}\n`, status: 'created' }
  }

  const beginIdx = existing.indexOf(LUMO_HOOK_BEGIN)
  if (beginIdx !== -1) {
    const endIdx = existing.indexOf(LUMO_HOOK_END, beginIdx)
    if (endIdx !== -1) {
      const before = existing.slice(0, beginIdx)
      const after = existing.slice(endIdx + LUMO_HOOK_END.length)
      const content = before + HOOK_SCRIPT_BLOCK + after
      return {
        content,
        status: content === existing ? 'unchanged' : 'updated',
      }
    }
    // BEGIN without END: corrupt block — fall through and append a clean one.
  }

  const sep = existing.endsWith('\n') ? '\n' : '\n\n'
  return {
    content: `${existing}${sep}${HOOK_SCRIPT_BLOCK}\n`,
    status: 'appended',
  }
}

/**
 * Decide whether `lumo setup` can write the hook directly. When
 * `core.hooksPath` is set (husky or a custom dir), writing into it risks being
 * clobbered or landing where git won't run it — so we degrade to instructions.
 */
export function resolveHookInstall(
  coreHooksPath: string | null
): { mode: 'install' } | { mode: 'degrade' } {
  if (coreHooksPath && coreHooksPath.trim() !== '') return { mode: 'degrade' }
  return { mode: 'install' }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/cli/git-hook-template.test.ts`
Expected: PASS (all 8 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/src/lib/git-hook-template.ts __tests__/cli/git-hook-template.test.ts
git commit -m "feat: git-hook-template module for prepare-commit-msg [LUM-149]"
```

---

### Task 2: Integration test for the shell script behavior

**Files:**

- Test: `__tests__/cli/prepare-commit-msg-script.test.ts`

This task validates that `HOOK_SCRIPT_BLOCK` actually does the right thing when run by `sh` inside a git repo. If a test fails, fix `HOOK_SCRIPT_BLOCK` in `git-hook-template.ts` until it passes.

- [ ] **Step 1: Write the failing integration test**

Create `__tests__/cli/prepare-commit-msg-script.test.ts`:

```ts
/**
 * @jest-environment node
 */
import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { HOOK_SCRIPT_BLOCK } from '@/cli/src/lib/git-hook-template'

// Build a throwaway git repo on an unborn branch, write the hook script, run
// it against a commit-message file, and return the resulting message text.
function runHook(branch: string, message: string, source = 'message'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumo-hook-'))
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir })
    // Point HEAD at the branch without needing a commit.
    execFileSync('git', ['symbolic-ref', 'HEAD', `refs/heads/${branch}`], {
      cwd: dir,
    })
    const hookPath = path.join(dir, 'hook.sh')
    fs.writeFileSync(hookPath, `#!/bin/sh\n${HOOK_SCRIPT_BLOCK}\n`)
    fs.chmodSync(hookPath, 0o755)
    const msgPath = path.join(dir, 'COMMIT_EDITMSG')
    fs.writeFileSync(msgPath, message)
    execFileSync('sh', [hookPath, msgPath, source], { cwd: dir })
    return fs.readFileSync(msgPath, 'utf8')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

describe('prepare-commit-msg script', () => {
  it('appends [LUM-N] from the branch when the subject lacks it', () => {
    const out = runHook('lumo/LUM-149-add-hook', 'feat: add the hook\n')
    expect(out).toContain('feat: add the hook [LUM-149]')
  })

  it('leaves the message untouched when it already has a [LUM-x] tag', () => {
    const out = runHook('lumo/LUM-149-add-hook', 'feat: add the hook [LUM-7]\n')
    expect(out).toBe('feat: add the hook [LUM-7]\n')
  })

  it('does nothing when the branch has no LUM-N', () => {
    const out = runHook('feature/no-id', 'feat: something\n')
    expect(out).toBe('feat: something\n')
  })

  it('skips merge commits', () => {
    const out = runHook('lumo/LUM-149-add-hook', "Merge branch 'x'\n", 'merge')
    expect(out).toBe("Merge branch 'x'\n")
  })

  it('appends after a leading comment/blank line, on the real subject', () => {
    const out = runHook(
      'lumo/LUM-149-add-hook',
      '# please enter a message\n\nfix: real subject\n'
    )
    expect(out).toContain('fix: real subject [LUM-149]')
    expect(out).toContain('# please enter a message')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/cli/prepare-commit-msg-script.test.ts`
Expected: PASS if Task 1's `HOOK_SCRIPT_BLOCK` is correct. If any case FAILS, fix `HOOK_SCRIPT_BLOCK` in `cli/src/lib/git-hook-template.ts` and re-run until green. (The test exists precisely to catch shell-quoting/awk mistakes.)

- [ ] **Step 3: Verify all cases pass**

Run: `npx jest __tests__/cli/prepare-commit-msg-script.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 4: Commit**

```bash
git add __tests__/cli/prepare-commit-msg-script.test.ts cli/src/lib/git-hook-template.ts
git commit -m "test: integration test for prepare-commit-msg script [LUM-149]"
```

---

### Task 3: Wire `installGitHook` into `setup.ts`

**Files:**

- Modify: `cli/src/commands/setup.ts`

- [ ] **Step 1: Add the import**

At the top of `cli/src/commands/setup.ts`, alongside the existing `mergeLumoHooks` import:

```ts
import {
  mergeGitHook,
  resolveHookInstall,
  HOOK_SCRIPT_BLOCK,
} from '../lib/git-hook-template'
```

- [ ] **Step 2: Call `installGitHook` from `setup()` (project scope only)**

In `setup()`, the tail currently reads:

```ts
installSkill(claudeDir, options.force === true)
mergeSettings(claudeDir, agentResult.token)
printPostInstall()

return 0
```

Change it to:

```ts
installSkill(claudeDir, options.force === true)
mergeSettings(claudeDir, agentResult.token)
if (scope === 'project') {
  installGitHook(root)
}
printPostInstall()

return 0
```

- [ ] **Step 3: Implement `installGitHook` + `printGitHookManualInstructions`**

Add these functions to `cli/src/commands/setup.ts` (e.g. after `mergeSettings`). `execSync` and `fs`/`path` are already imported in this file.

```ts
function gitCapture(cwd: string, args: string): string | null {
  try {
    return execSync(`git ${args}`, {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim()
  } catch {
    return null
  }
}

function installGitHook(projectRoot: string): void {
  if (gitCapture(projectRoot, 'rev-parse --is-inside-work-tree') !== 'true') {
    process.stdout.write(
      '• Not a git repository — skipped prepare-commit-msg hook.\n'
    )
    return
  }

  const coreHooksPath = gitCapture(projectRoot, 'config core.hooksPath') || null
  if (resolveHookInstall(coreHooksPath).mode === 'degrade') {
    printGitHookManualInstructions(coreHooksPath!)
    return
  }

  const hooksDirRaw = gitCapture(projectRoot, 'rev-parse --git-path hooks')
  if (!hooksDirRaw) {
    process.stdout.write(
      '⚠ could not resolve git hooks dir — skipped prepare-commit-msg hook.\n'
    )
    return
  }
  const absHooksDir = path.isAbsolute(hooksDirRaw)
    ? hooksDirRaw
    : path.join(projectRoot, hooksDirRaw)
  const hookPath = path.join(absHooksDir, 'prepare-commit-msg')

  const existing = fs.existsSync(hookPath)
    ? fs.readFileSync(hookPath, 'utf8')
    : null
  const { content, status } = mergeGitHook(existing)

  if (status === 'unchanged') {
    process.stdout.write(
      `✓ prepare-commit-msg hook already up to date: ${hookPath}\n`
    )
    return
  }

  fs.mkdirSync(absHooksDir, { recursive: true })
  fs.writeFileSync(hookPath, content)
  fs.chmodSync(hookPath, 0o755)

  const verb =
    status === 'created'
      ? 'wrote'
      : status === 'appended'
        ? 'appended to'
        : 'updated'
  process.stdout.write(`✓ ${verb} prepare-commit-msg hook: ${hookPath}\n`)
}

function printGitHookManualInstructions(coreHooksPath: string): void {
  process.stdout.write(
    `\n⚠ core.hooksPath is set to "${coreHooksPath}" (husky or a custom hooks dir).\n` +
      `  Skipped auto-install to avoid clobbering it. To auto-tag commits with\n` +
      `  [LUM-N], add this block to your prepare-commit-msg hook\n` +
      `  (e.g. .husky/prepare-commit-msg), then make it executable:\n\n` +
      HOOK_SCRIPT_BLOCK +
      `\n\n`
  )
}
```

- [ ] **Step 4: Type-check**

Run: `cd cli && npx tsc --noEmit && cd ..`
Expected: no errors.

> If `tsc` reports unrelated stale-client errors, run `npx prisma generate` first (project memory). For the CLI package, there is no Prisma client — a clean `tsc` is expected.

- [ ] **Step 5: Manual smoke test (install path, in a throwaway repo)**

This repo uses husky, so running `setup` here would only show the degrade path
and could touch tracked files. Test the real install path in a temp repo instead:

```bash
cd cli && npm run build && cd ..
TMP=$(mktemp -d) && git -C "$TMP" init -q
git -C "$TMP" symbolic-ref HEAD refs/heads/lumo/LUM-149-smoke
( cd "$TMP" && node "$OLDPWD/cli/dist/cli/src/index.js" setup --project )
echo "--- installed hook ---" && cat "$TMP/.git/hooks/prepare-commit-msg"
# Exercise it:
printf 'feat: smoke test\n' > "$TMP/.git/COMMIT_EDITMSG"
( cd "$TMP" && sh .git/hooks/prepare-commit-msg .git/COMMIT_EDITMSG message )
echo "--- rewritten message ---" && cat "$TMP/.git/COMMIT_EDITMSG"
rm -rf "$TMP"
```

Expected: setup prints `✓ wrote prepare-commit-msg hook: ...`; the installed file
contains the `# >>> lumo prepare-commit-msg >>>` block; the rewritten message
reads `feat: smoke test [LUM-149]`.

> Confirm this repo itself is untouched by the build: `git status --short` should
> show only your intended source changes (and ignore generated `cli/assets/`).

- [ ] **Step 6: Commit**

```bash
git add cli/src/commands/setup.ts
git commit -m "feat: setup installs prepare-commit-msg hook (husky-aware) [LUM-149]"
```

---

### Task 4: Docs + version bump

**Files:**

- Modify: `.claude/skills/lumo/SKILL.md`
- Modify: `cli/package.json`

- [ ] **Step 1: Update the SKILL.md setup section**

In `.claude/skills/lumo/SKILL.md`, find the `### \`lumo setup ...\`` section. After the paragraph describing the SKILL.md copy + settings.json hook merge, add:

```markdown
On `--project` scope, setup also installs a `prepare-commit-msg` git hook that
auto-appends the branch's task ID (`[LUM-N]`, parsed from a `lumo/LUM-N-...`
branch name) to any commit subject that lacks it. The hook is pure sh + git
(no network, no `lumo` call) and is merged idempotently between
`# >>> lumo prepare-commit-msg >>>` / `# <<< lumo <<<` markers, preserving any
existing hook content. When `core.hooksPath` is set (husky or a custom hooks
dir), setup does **not** write the file — it prints the block plus instructions
to add it manually (e.g. to `.husky/prepare-commit-msg`). `--user` scope does
not touch git hooks.
```

- [ ] **Step 2: Verify the edit reads correctly**

Run: `grep -n "prepare-commit-msg" .claude/skills/lumo/SKILL.md`
Expected: at least one match in the setup section.

- [ ] **Step 3: Bump the CLI version**

In `cli/package.json`, bump the `"version"` field one minor (e.g. `1.9.0` → `1.10.0`). Confirm the current value first:

Run: `grep '"version"' cli/package.json`

Then edit the field to the next minor.

- [ ] **Step 4: Run the full CLI test suite**

Run: `npx jest __tests__/cli/`
Expected: PASS, including the two new test files and the existing `hooks-template` / `setup-agent-token` suites.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/lumo/SKILL.md cli/package.json
git commit -m "docs: document prepare-commit-msg hook + bump CLI [LUM-149]"
```

---

## Post-implementation

- Open a PR titled `feat: setup installs commit-msg task-ID hook [LUM-149]`.
- PR description must note: **new git hook installed by `lumo setup --project`**; **husky/custom-`core.hooksPath` repos get manual instructions**; **CLI version bumped — requires a manual `cd cli && npm publish` after merge** (CI does not publish; project memory).
- No npm packages added, no schema/migration changes.
