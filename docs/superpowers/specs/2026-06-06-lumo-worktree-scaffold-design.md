# Design: `lumo worktree` command group (LUM-267)

**Task:** LUM-267 — 新增 worktree 脚手架命令（node_modules 软链 + prisma 隔离 + jest cwd）
**Date:** 2026-06-06
**Status:** Approved (design phase)

## Problem

Every new parallel git worktree forces the same manual ritual, each step a known
foot-gun captured in team memory:

1. **node_modules symlink** — a fresh `.worktrees/<id>` has no `node_modules`;
   jest/tsc can't run until it is symlinked to the main checkout's
   `node_modules`. (memory: `worktree_per_task_node_modules_symlink`)
2. **prisma client clobber** — because `node_modules` is a single symlink,
   `node_modules/.prisma/client` is shared across all worktrees. A
   `prisma generate` on schema A overwrites the client a parallel worktree on
   schema B depends on, so `tsc` then sees the *other* branch's columns.
   (memory: `worktree_prisma_generate_shared_client_clobber`)
3. **jest cwd haste collision** — running jest from the main checkout hits a
   `cli/package.json` haste-map collision and silently runs the main tree's old
   tests; jest must be invoked with cwd inside the worktree.
   (memory: `worktree_jest_cwd_haste_collision`)

Goal: wrap the create / remove / list lifecycle into one command group so the
ritual is one command and the gotchas are codified as printed guidance.

## Non-goals

- **True per-worktree prisma client isolation.** Considered and rejected: it
  would require either a full `npm install` per worktree (slow, defeats the
  symlink) or per-worktree edits to `schema.prisma`'s generator output (mutating
  a tracked file). Both are worse than the procedural workaround the team
  already uses. The command surfaces the gotcha as guidance instead of trying to
  magically fix it.
- No server interaction. This is a local dev-tooling command (like `setup`);
  the slug is user-provided, so no `task show` lookup is needed and the command
  stays usable offline.

## Command surface

```
lumo worktree add  <LUM-N> [slug]   # create + finish in one shot
lumo worktree rm   <LUM-N>          # safe cleanup
lumo worktree list                  # list worktrees under .worktrees/
```

Fits the existing noun-verb command pattern (`task`, `milestone`, `sprint`).

## `add <LUM-N> [slug]`

The core command. Steps:

1. **Must run from the main checkout** (`GIT_DIR == GIT_COMMON`). Running inside
   a linked worktree errors out — the node_modules symlink source and the
   `.worktrees/` dir both live in the main checkout.
2. Normalize the id (reuse `matchTaskIdentifier` from `git-task.ts`; accept
   `LUM-267` / `267` / `lum-267`). Derive `branch = lumo/LUM-267[-<slug>]` and
   `dir = <root>/.worktrees/LUM-267[-<slug>]`. With no slug, both fall back to
   the bare `LUM-267` form.
3. Verify `.worktrees/` is gitignored (it is); create the directory if missing.
   If the target `dir` already exists → error and exit (never overwrite).
4. `git fetch origin main` (skip with `--no-fetch`); branch off `origin/main`
   (override with `--base <ref>`). The default fetch matches the memory lesson
   that origin/main moves under long-lived branches.
5. `git worktree add <dir> -b <branch> <base>`. If `<branch>` already exists,
   reuse it: `git worktree add <dir> <branch>` (no `-b`). Surface git's
   "already checked out elsewhere" error clearly.
6. **Symlink node_modules**: `ln -s <root>/node_modules <dir>/node_modules`.
   If `<root>/node_modules` is missing, warn (tell the user to `npm install` in
   the main checkout first) rather than creating a dangling link.
7. Print the **finish-up guidance** block:
   - `cd <dir>` — the CLI cannot change the parent shell's cwd, so the user must
     cd manually.
   - ⚠️ prisma: the client is shared via the symlink; don't run
     `prisma generate` mid-work across parallel worktrees; verify with jest,
     and do `generate + tsc` atomically once at the end.
   - ⚠️ jest: always `cd` into the worktree before running it, or you hit the
     `cli/package.json` haste collision and run the wrong tests.
8. `--verify` (default **off**): run `npx jest` inside the worktree to confirm a
   clean baseline. Off by default because it is slow.

### `add` defaults (approved)

- fetch + branch off `origin/main` by default (`--no-fetch` / `--base` override)
- `--verify` off by default
- target dir already exists → error, never overwrite

## `rm <LUM-N>`

Safe cleanup. Steps:

1. Locate the worktree dir by LUM-N from `git worktree list --porcelain`
   (match `.worktrees/<LUM-N>*` dir or the `lumo/<LUM-N>...` branch name).
2. **Requires `--yes`** (destructive, per existing CLI convention). If the
   worktree has uncommitted changes, refuse unless `--force`.
3. `git worktree remove <dir>` (add git's `--force` only when dirty AND the user
   confirmed with `--force`).
4. The branch is **kept by default** (it may carry unpushed work or an open PR).
   `--delete-branch` deletes it with the safe `git branch -d` (which refuses an
   unmerged branch on its own).

## `list`

Parse `git worktree list --porcelain`; show only the worktrees under
`.worktrees/`. Each row carries: LUM-N, branch, dir, dirty?, and whether
`node_modules` is symlinked. The node_modules-link column is the value-add over
a bare `git worktree list` — a dangling/missing link is the first thing to check
when jest/tsc misbehaves.

## Code structure

- `cli/src/commands/worktree-add.ts`, `worktree-rm.ts`, `worktree-list.ts` — one
  command function each (named exports), following the existing command-module
  shape.
- `cli/src/lib/worktree.ts` — shared, mostly-pure helpers that are unit-testable:
  - id normalization → branch / dir derivation
  - `git worktree list --porcelain` parsing → structured entries
  - lookup of a worktree by LUM-N
  - git invocation via the `spawnSync('git', args, { cwd, encoding, timeout })`
    pattern from `git-task.ts` (no new dependency).
- `cli/src/index.ts` — register `const worktree = program.command('worktree')`
  with the three subcommands, wrapped in the existing `wrap()` helper.

Each unit has one clear purpose: the lib holds pure derivation/parsing, the
command modules orchestrate git + filesystem side effects and printing.

## Error handling

- Not in a git repo / not the main checkout → clear error, non-zero exit.
- Target worktree dir already exists (`add`) → error, no overwrite.
- Branch already checked out elsewhere → surface git's message.
- Missing main `node_modules` (`add`) → warn, continue (don't create a dangling
  symlink).
- `rm` on a dirty worktree without `--force` → refuse with an explanatory
  message; `rm` without `--yes` → refuse.
- All git calls go through the shared helper; non-zero git exits become CLI
  errors via `wrap()`.

## Testing

`cli/__tests__/worktree.test.ts` — unit tests over the pure helpers (id
normalization, branch/dir derivation, porcelain parsing, worktree lookup).
git-calling paths mock `child_process`. Satisfies the CLAUDE.md rule that every
new function has at least one test.

## Docs & publish (CLAUDE.md requirements)

- Update `.claude/skills/lumo/SKILL.md`: add trigger words to the frontmatter
  `description` (worktree / 并行 / 隔离 / scaffold …), add the command group to
  the catalog table, and document behavior in a new `references/worktree.md`.
- Bump `cli/package.json` by a minor version (feat). Note in the PR description
  that a manual `cd cli && npm publish` is required — `lumo update` only delivers
  published versions (memory: `cli_publish_version_bump`).
