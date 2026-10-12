# Worktrees

Local dev tooling for one git worktree per task, wired into the task
lifecycle: `session attach` reports (or, opted in, creates) the task's
worktree, and the DONE transition cleans it up. Everything runs against local
git; the only server calls are a `GET /api/teams` to expand a **bare number**
to your default team prefix (see "Accepted identifier forms"), and — for DONE
cleanup and `prune` — a task lookup for its status and merged PR heads.

Works in any git repo (LUM-825): the base branch is the **remote's default
branch** (`origin/HEAD` — `main`, `master`, `develop`, …), nothing Node- or
husky-specific happens unless the repo has it, and repo-specific behaviour
comes from an optional `.lumo/worktree.json` (below). **Run `add` and `rm`
from the main checkout**; `list` and `prune` run from anywhere in the repo.

### Accepted identifier forms

The `<id>` argument to `add`/`rm` is a task id with **any team prefix**, not
just `LUM-` (the `<LUM-N>` in the examples below is just a placeholder):

- `LUM-267`, `SPEC-12`, `spec-12` — an explicit `<TEAM>-<n>` (1–10 letters,
  case-insensitive; the prefix is upper-cased). Resolved locally, no network.
- `267` — a **bare number**: expanded to the workspace's **default team**
  prefix via `GET /api/teams` (or the sole team in a single-team workspace).
  In a multi-team workspace with no default, this errors and asks for an
  explicit prefix; the same happens when you're offline / not logged in.

## `.lumo/worktree.json` — repo-specific settings (optional)

Committed at the repo root. No file = plain, repo-agnostic behaviour. A key
that is present **replaces** the auto-detected default for that key; a
malformed file only prints warnings, it never blocks a command. `linkPaths` /
`copyPaths` entries must be relative paths inside the repo — an absolute
path, a `..` segment, or one that resolves outside the checkout through a
symlink is skipped with a warning.

| Key             | Default when absent                                                   | Notes                                                                                         |
| --------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `linkPaths`     | `["node_modules"]` if the main checkout has one, else `[]`            | Symlinked from the main checkout. `[]` turns the link off.                                    |
| `copyPaths`     | the husky shim (`.husky/_`) if `core.hooksPath` points into `.husky/` | Copied (not linked). Plain `.git/hooks` are shared anyway.                                    |
| `verifyCommand` | none — `add --verify` warns and skips                                 | Shell command run inside the new worktree — only after the user approves it (see `--verify`). |
| `notes`         | none                                                                  | Repo gotchas printed after `add`.                                                             |
| `autoWorktree`  | `false`                                                               | `session attach` creates the task's worktree when none exists.                                |

This repo's own file links `node_modules`, copies `.husky/_`, verifies with
`npx jest`, sets `autoWorktree: true`, and carries the prisma / jest / npm
notes below.

## `lumo worktree add <LUM-N> [slug]`

Creates `.worktrees/<LUM-N>[-slug]` on branch `lumo/<LUM-N>[-slug]`, branched
off the freshly fetched remote default branch. Also makes sure `.worktrees/`
never shows as untracked: if `.gitignore` does not cover it, `/.worktrees/`
goes into `.git/info/exclude` (local to the clone; the tracked `.gitignore` is
never edited). Then applies the link/copy plan and prints the `cd` step plus
any `notes`.

```bash
lumo worktree add LUM-267 worktree-scaffold   # → .worktrees/LUM-267-worktree-scaffold
lumo worktree add LUM-267                      # → .worktrees/LUM-267
lumo worktree add LUM-267 --base develop       # branch off a local ref, skip fetch
lumo worktree add LUM-267 --no-fetch           # branch off the existing origin/<default>
lumo worktree add LUM-267 --verify             # exit 4: envelope shows verifyCommand, creates nothing
lumo worktree add LUM-267 --verify --confirm   # after the user approved: create, then run it
```

| Flag           | Notes                                                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--base <ref>` | Branch off this ref instead of the remote default branch (skips the fetch).                                                                                               |
| `--no-fetch`   | Skip the fetch; branch off the existing `origin/<default>`.                                                                                                               |
| `--verify`     | Run `verifyCommand` from `.lumo/worktree.json` in the new worktree. Gated: without `--confirm` it exits 4 with an envelope showing the exact command and creates nothing. |
| `--confirm`    | The user approved that command. Only meaningful with `--verify`.                                                                                                          |

`verifyCommand` comes from a committed file, so it is never run on `--verify` alone: relay the envelope (it prints the command verbatim) and run `confirmCommand` only after the user says they trust it — never add `--confirm` yourself. A command containing control characters (which could display differently from what runs) is refused with exit 1 even with `--confirm`. Without a `verifyCommand`, `--verify` just warns — no envelope.

Default-branch detection: `origin/HEAD` → (online) `git remote set-head origin --auto` → a local `origin/main` / `origin/master`. If none answers it exits 1 asking for `--base`. Errors if the target dir already exists; reuses the branch if it already exists (adds the worktree without `-b`).

### Gotchas in this repo (printed from `notes`)

- **`prisma generate` clobbers all worktrees.** The generated client lives in the shared (symlinked) `node_modules`, so a `generate` in one worktree overwrites the client every parallel worktree depends on. Verify with jest (SWC mocks Prisma); do `generate + tsc` atomically once at the end.
- **Run jest from the worktree root** (`cd` in first). `cli/` has no jest config; running from the main checkout hits the `cli/package.json` haste collision and silently runs the wrong tests.
- **Never `npm install` / `npm ci` inside a worktree.** npm doesn't respect the `node_modules` symlink — it deletes it and reifies a full standalone tree (~1 min, shared prisma-client gone). Install only in the main checkout, then re-create the symlink if npm replaced it.
- **Why the husky shim is copied:** husky owns hooks via `core.hooksPath = .husky/_`, resolved per worktree root, and that dir is untracked — without the copy git **silently skips every hook** (pre-commit lint-staged, commit-msg drift-check). If the main checkout has no `.husky/_`, `add` warns; run `npm install` there.

## Lifecycle integration

- **`session attach`** — after the bind, lists the task's worktree(s) by path (all of them when several match — it never picks one silently), marks the one you are in, or hints `lumo worktree add <id>`. It **creates** one (slug = first words of the title) only with `--worktree` or `autoWorktree: true` (`--no-worktree` overrides), only from the main checkout (in any linked worktree it says so and creates nothing), and a creation failure is a warning — attach still succeeds. See [sessions.md](sessions.md).
- **`task update <id> --status done`** — the DONE envelope gets one line per task worktree: `Will remove worktree <path> (branch … kept)` or `Keeps worktree <path>: <reason>`. After `--confirm` and a successful DONE, only the removable ones are removed (re-checked at that moment). See the safety rules below and [confirmation.md](confirmation.md).
- **`lumo worktree prune`** — the catch-all for tasks closed on the web or on another machine.

### Safety rules (DONE cleanup and `prune`)

A worktree is removed only when nothing can be lost:

1. the current directory is **not** inside it (else: kept, with a `git -C <main> worktree remove <path>` to run later);
2. `git status --porcelain` is empty (uncommitted or untracked changes → kept);
3. every commit is on some remote ref, **or** HEAD is exactly the head commit of a **merged linked PR** — so a squash-merged branch whose remote branch was deleted is removable, but a commit added after the merge keeps it. (Servers older than LUM-825 don't send PR head commits; then only "pushed" counts, which only ever keeps more.)

Never `--force`, and **branches are never deleted** by the cleanup — use `worktree rm --delete-branch` for that.

### A process still writing into the worktree (DONE, `prune`, `rm`)

A dev server left running in the worktree regenerates files (e.g.
`app/.well-known/workflow/v1/**`) while git deletes it; git then stops with
`Directory not empty` but has already unregistered the worktree. Once git has
unregistered it — i.e. git already judged it safe to delete — the CLI finishes
the delete itself (a few retries), and prints `✓ Removed worktree <path>` as
usual. If something keeps recreating files, it prints instead:

```
⚠ worktree <path> is unregistered from git, but its directory could not be fully deleted — something kept writing into it.
  Left behind: app/ (1 file), node_modules/ (10000+ files)
  Still running inside it: pid 123 (node) — stop it (e.g. the dev server) first
  Clean up with: rm -rf '<path>'
```

Relay it; the user stops the process and runs the `Clean up with` line (the
`Still running` line appears only when `lsof` finds one). `worktree rm` exits 1
in this case. When git **refuses** (the worktree is still registered), nothing
is deleted — that is the uncommitted-changes path above, unchanged.

## `lumo worktree rm <LUM-N>`

Removes the worktree for a task. Gated by the confirmation protocol
([confirmation.md](confirmation.md)): without `--confirm` — or with
uncommitted changes and no `--force` — it exits **4** with an envelope naming
the path and branch, a `⚠ … uncommitted changes … discarded` line when dirty,
and whether the branch is kept or deleted; nothing is removed. A dirty tree's
`confirmCommand` carries `--force --confirm`. `--yes` is a legacy alias of
`--confirm`. Keeps the branch by default (it may hold unpushed work / an open
PR); `--delete-branch` removes it with `git branch -d` (which itself refuses
an unmerged branch — including a squash-merged one).

When **several worktrees** match the task it exits 1 and lists each as a
`git worktree remove <path>` line — it never picks one for you.

```bash
lumo worktree rm LUM-267                              # exit 4 + envelope
lumo worktree rm LUM-267 --confirm                    # after the user approved (clean tree)
lumo worktree rm LUM-267 --force --confirm            # dirty tree: discard uncommitted changes
lumo worktree rm LUM-267 --confirm --delete-branch    # also delete lumo/LUM-267…
```

## `lumo worktree prune`

Looks up the task of every task worktree (id from the dir name or branch) and
considers only tasks that are **DONE**; applies the safety rules above.
Without `--confirm` it exits 4 with an envelope: one `LUM-N (DONE): Will
remove …` / `Keeps …: <reason>` line per worktree, plus counts of worktrees
left alone because their task is not DONE or could not be looked up. When
nothing is removable it just says so (exit 0, no envelope). Never deletes
branches.

```bash
lumo worktree prune              # exit 4 + envelope
lumo worktree prune --confirm    # after the user approved
```

## `lumo worktree list`

Lists worktrees under `.worktrees/` with task id, branch, dirty state, and —
only when the main checkout has a `node_modules` — whether it is symlinked (a
`MISSING` link is the first thing to check when jest/tsc misbehaves). Read-only; runnable from
anywhere in the repo.

```bash
lumo worktree list
```

## When to suggest worktrees

- The user wants to work on a task **in isolation** from the current workspace — a parallel branch they can build/test without disturbing uncommitted work in the main checkout.
- Starting a second task while one is in flight, or running independent tasks concurrently (one worktree per task — never two tasks in one worktree).
- Before executing an implementation plan that needs a clean, dedicated branch off the default branch.
- `.worktrees/` has piled up with finished tasks → `lumo worktree prune` (relay the envelope; never add `--confirm` yourself).
- A `MISSING` node_modules link in `lumo worktree list` is the first thing to check when jest/tsc misbehaves in a worktree.
