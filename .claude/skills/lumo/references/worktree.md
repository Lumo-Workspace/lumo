# Worktrees

Local dev tooling that scaffolds parallel git worktrees. These are almost
entirely local — they shell out to git and the local filesystem; the **only**
server call is a single `GET /api/teams` to expand a **bare number** to your
default team prefix (see "Accepted identifier forms" below), and even that is
skipped when you pass an explicit `<TEAM>-N`. **Run `add` and `rm` from the main
checkout**, not from inside a worktree (the node_modules symlink source and
`.worktrees/` both live there); `list` is read-only and runnable from anywhere.

### Accepted identifier forms

The `<id>` argument to `add`/`rm` is a task id with **any team prefix**, not
just `LUM-` (the `<LUM-N>` in the examples below is just a placeholder):

- `LUM-267`, `SPEC-12`, `spec-12` — an explicit `<TEAM>-<n>` (1–10 letters,
  case-insensitive; the prefix is upper-cased). Resolved locally, no network.
- `267` — a **bare number**: expanded to the workspace's **default team**
  prefix via `GET /api/teams` (or the sole team in a single-team workspace).
  In a multi-team workspace with no default, this errors and asks for an
  explicit prefix; the same happens when you're offline / not logged in.

## `lumo worktree add <LUM-N> [slug]`

Creates `.worktrees/<LUM-N>[-slug]` on branch `lumo/<LUM-N>[-slug]`, branched off
`origin/main` (after a fetch), and symlinks its `node_modules` to the main
checkout so jest/tsc work immediately. In the same scaffold step it copies the
main checkout's `.husky/_` hooks shim into the worktree so git hooks actually
fire there (see below). With no slug, the dir and branch use the bare `LUM-N`
form. Prints next-step guidance plus the two gotchas it can't fix for you
(shared prisma client, jest cwd).

```bash
lumo worktree add LUM-267 worktree-scaffold   # → .worktrees/LUM-267-worktree-scaffold
lumo worktree add LUM-267                      # → .worktrees/LUM-267
lumo worktree add LUM-267 --base main          # branch off local main, skip fetch
lumo worktree add LUM-267 --no-fetch           # branch off existing origin/main
lumo worktree add LUM-267 --verify             # run npx jest baseline after setup
```

| Flag           | Notes                                                           |
| -------------- | --------------------------------------------------------------- |
| `--base <ref>` | Branch off a ref other than origin/main (skips the fetch).      |
| `--no-fetch`   | Skip `git fetch origin main` (branch off existing origin/main). |
| `--verify`     | Run `npx jest` baseline in the new worktree after setup.        |

Errors if the target dir already exists; reuses the branch if it already exists (adds the worktree without `-b`).

### Gotchas (two it warns about, two it can't fix)

- **`prisma generate` clobbers all worktrees.** The generated client lives in the shared (symlinked) `node_modules`, so a `generate` in one worktree overwrites the client every parallel worktree depends on. Verify with jest (SWC mocks Prisma); do `generate + tsc` atomically once at the end.
- **Run jest from the worktree root** (`cd` in first). `cli/` has no jest config; running from the main checkout hits the `cli/package.json` haste collision and silently runs the wrong tests.
- **Husky hooks are copied in for you.** Husky owns hooks via `core.hooksPath = .husky/_`, resolved relative to each worktree's root. That `_` shim is **untracked** (regenerated on the main checkout's `npm install`/`prepare`), so a fresh worktree would lack it and git would **silently skip every hook** — pre-commit (lint-staged) and commit-msg (drift-check). With no GitHub CI, husky is the only deterministic quality gate, so `add` copies `.husky/_` in (copy, not symlink). If the main checkout has no `.husky/_`, `add` warns you to `npm install` there rather than skipping silently.
- **Never `npm install` / `npm ci` inside a worktree.** npm doesn't respect the `node_modules` symlink — it deletes it and reifies a full standalone tree (~1 min, shared prisma-client gone). Install only in the main checkout, then re-create the symlink if npm replaced it. (Older npm could plant a self-referential `node_modules/node_modules` that hard-panics Turbopack's `next build`; the `prebuild`/`predev`/`preanalyze` guard `scripts/fix-nodemodules-selflink.ts` removes it, but this rule avoids the mess.)

## `lumo worktree rm <LUM-N>`

Removes the worktree for a task. Gated by the confirmation protocol
([confirmation.md](confirmation.md)): without `--confirm` — or with
uncommitted changes and no `--force` — it exits **4** with an envelope naming
the path and branch, a `⚠ … uncommitted changes … discarded` line when dirty,
and whether the branch is kept or deleted; nothing is removed. A dirty tree's
`confirmCommand` carries `--force --confirm`. `--yes` is a legacy alias of
`--confirm`. Keeps the branch by default (it may hold unpushed work / an open
PR); `--delete-branch` removes it with `git branch -d` (which itself refuses
an unmerged branch).

```bash
lumo worktree rm LUM-267                              # exit 4 + envelope
lumo worktree rm LUM-267 --confirm                    # after the user approved (clean tree)
lumo worktree rm LUM-267 --force --confirm            # dirty tree: discard uncommitted changes
lumo worktree rm LUM-267 --confirm --delete-branch    # also delete lumo/LUM-267…
```

## `lumo worktree list`

Lists worktrees under `.worktrees/` with task id, branch, dirty state, and
whether `node_modules` is symlinked (a `MISSING` link is the first thing to
check when jest/tsc misbehaves). Read-only; runnable from anywhere in the repo.

```bash
lumo worktree list
```

## When to suggest worktrees

- The user wants to work on a task **in isolation** from the current workspace — a parallel branch they can build/test without disturbing uncommitted work in the main checkout.
- Starting a second task while one is in flight, or running independent tasks concurrently (one worktree per task — never two tasks in one worktree).
- Before executing an implementation plan that needs a clean, dedicated branch off `origin/main`.
- A `MISSING` node_modules link in `lumo worktree list` is the first thing to check when jest/tsc misbehaves in a worktree.
