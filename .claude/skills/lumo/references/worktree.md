# Worktrees

Local dev tooling that scaffolds parallel git worktrees. Unlike every other
`lumo` command, these do **not** touch the Lumo server — they shell out to git
and the local filesystem. **Run `add` and `rm` from the main checkout**, not from
inside a worktree (the node_modules symlink source and `.worktrees/` both live
there); `list` is read-only and runnable from anywhere.

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

Flags: `--base <ref>` (branch off a ref other than origin/main; skips the
fetch), `--no-fetch` (skip `git fetch origin main`), `--verify` (run `npx jest`
in the new worktree). Errors if the target dir already exists; reuses the branch
if it already exists (adds the worktree without `-b`).

**The prisma gotcha it warns about:** the generated client lives in the shared
(symlinked) `node_modules`, so a `prisma generate` in one worktree clobbers the
client every parallel worktree depends on. Verify with jest (SWC mocks Prisma);
do `generate + tsc` atomically once at the end.

**The jest gotcha it warns about:** always run jest from the worktree root (`cd`
in first) — `cli/` has no jest config, and running from the main checkout hits
the `cli/package.json` haste collision and silently runs the wrong tests.

**The husky hooks it copies in:** husky owns git hooks via
`core.hooksPath = .husky/_`, a relative path git resolves against each
worktree's own root. That `_` shim dir is **untracked** (husky regenerates it on
the main checkout's `npm install`/`prepare`), so a fresh worktree would lack it
and git would **silently skip every hook** — pre-commit (lint-staged) and
commit-msg (LUM-405 drift-check) included. Since this repo has no GitHub CI,
husky is the only deterministic quality gate, so `add` copies `.husky/_` into the
new worktree (copy, not symlink — the shim is tiny and the hooks it invokes
resolve relative to the worktree). If the main checkout itself has no `.husky/_`
(husky never installed there), `add` prints a warning telling you to run
`npm install` in the main checkout to regenerate it, rather than skipping
silently.

**Never run `npm install` / `npm ci` inside a worktree.** The worktree shares
the main checkout's `node_modules` via a symlink; npm does not respect the link
— it deletes it and reifies a full standalone `node_modules` (thousands of
packages, ~1 min, and the shared prisma-client is gone). Run installs only in
the main checkout, then re-create the symlink if npm replaced it. (Older npm
could instead plant a self-referential `node_modules/node_modules` in the shared
tree, which hard-panics Turbopack's `next build`; the `prebuild`/`predev`/
`preanalyze` guard — `scripts/fix-nodemodules-selflink.ts` — removes that link
automatically, but the rule above avoids the whole mess.)

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
