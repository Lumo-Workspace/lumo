# Local security scans — `lumo security scan`

`lumo security scan` runs Lumo's security scanners **on this machine, on your uncommitted and unpushed changes**, so a problem is caught before it reaches a PR. It is read-only unless you pass `--log`: nothing is uploaded, no task or finding changes (the only write is the server-context cache under `~/.lumo/cache/scan-context/`). With `--log` (opt-in, [below](#local-scan-log---log)) each scanned commit's result is recorded on the server. The PR scan stays the only authority for DONE — a clean local scan never clears a gate, and a local finding never blocks one.

Scanners today: `SECRETS` (`--secrets`). With no scanner flag, every local scanner runs.

## What `SECRETS` checks

The **same deterministic secret scanner as the PR scan's first stage** (the code lives in `shared/src/secret-scan/`; the server imports the identical module), over the lines your changes add. No network, no binary, typically well under a second. Findings carry the server's fingerprints, so a local finding is the same finding the PR scan will report.

## Flags

| Flag                  | Notes                                                                                                                                                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--secrets`           | Run the secret scanner. No scanner flag = every local scanner.                                                                                                                                                                                                                             |
| _(no scope flag)_     | From the merge-base with the default branch (`origin/HEAD`, else `origin/main` / `origin/master`) to the **working tree**: committed, staged and unstaged edits, plus untracked files (not ignored ones).                                                                                  |
| `--staged`            | Only the index (`git diff --cached`) — what the next commit will contain. For a pre-commit hook. Untracked files are not read.                                                                                                                                                             |
| `--since <ref>`       | From `<ref>` (as given, not its merge-base) to the working tree, untracked files included. Not with `--staged`.                                                                                                                                                                            |
| `--until <ref>`       | End at this commit instead of the working tree: only committed changes, no untracked files. With `--since` the range is `<since>` → `<until>`; alone it starts at the merge-base of `<until>` with the default branch. Not with `--staged`. For a pre-push hook.                           |
| `--fail-on <level>`   | `low` \| `medium` \| `high` (case-insensitive): exit **3** when any finding is at or above it. `done`: exit 3 when a finding **would block DONE** under the workspace policy (the `Server:` label below) — without server context nothing can, so it never exits 3 and says so on stderr.  |
| `--timeout <seconds>` | Wait at most this long for the Lumo server (default 8; more than 0, at most 60), then fall back to the cached context. Not with `--offline`.                                                                                                                                               |
| `--json`              | The list envelope (below).                                                                                                                                                                                                                                                                 |
| `--offline`           | Label findings from the cached server context only — no Lumo API call. No cache yet = no labels. Not with `--pr`.                                                                                                                                                                          |
| `--pr`                | When the branch has an open PR: merge in that PR's latest server scan — its findings you fixed locally since the last push vs those still reported, and the server-only layers (AI review, hunt).                                                                                          |
| `--repo <owner/repo>` | The repository to read server context for, instead of the one `origin` points at (a fork's origin, a non-GitHub remote).                                                                                                                                                                   |
| `--commit <ref>`      | Scan one commit against its first parent (a root commit: all of it). Merge commits are skipped. Not with `--staged`, `--since` or `--until`. Each finding names its `Commit`.                                                                                                              |
| `--log`               | Record each scanned commit's result on the Lumo server ([below](#local-scan-log---log)). Needs `--commit <ref>`, or `--until <ref>` (with or without `--since`) — then every non-merge commit of the range is scanned on its own (at most 50, newest kept). Not with `--staged` or `--pr`. |

```bash
lumo security scan
lumo security scan --secrets --staged --fail-on high
lumo security scan --since origin/main --json
lumo security scan --pr
lumo security scan --staged --offline --fail-on high
lumo security scan --staged --fail-on done --timeout 2     # what the pre-commit hook runs
lumo security scan --since origin/feature --until HEAD     # the commits a push would send
lumo security scan --commit HEAD                           # one commit against its parent
lumo security scan --commit HEAD --log                     # …and record it on the server (opt-in)
lumo security scan --since origin/main --until HEAD --log  # record each unpushed commit
```

Run it from anywhere inside the repository; paths are repo-relative. Untracked files that are binary, symlinks, unreadable or over 2 MiB are skipped and listed on a `Skipped …` line.

## Server context

Each run asks the Lumo server what it already knows about this repository (`GET /api/workspaces/me/security-scan/context`, any workspace member): the default branch's **baseline** fingerprints, human **rulings** (false positive / accepted risk — who, when, on which PR), the active **review learnings** in the workspace's learnings scope, the workspace **security policy**, and the branch's open PR. Fingerprints, rule ids and statuses only — never code or evidence. It is cached by ETag under `~/.lumo/cache/scan-context/`; `--offline` reads only the cache, and an unreachable server falls back to it.

**What it sends:** two read-only `GET`s with no body. The context request carries only the repository (`owner/name`, from `origin` or `--repo`) and the checked-out branch name. With `--pr`, a second request carries that repository and the PR number the server returned (the `lumo pr show` read). No file path, line, fingerprint, evidence or file content leaves the machine; labelling happens locally. Inside Codex's no-network sandbox the requests fail fast, and the scan falls back to the cache, or to no context, with exit 0.

Each finding then gets a `Server:` label:

| Label                                                           | Meaning                                                                                                                                                                       |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `new`                                                           | The server knows nothing about this fingerprint.                                                                                                                              |
| `already on main`                                               | In the default branch's baseline — persisting, never this PR's to block on.                                                                                                   |
| `ruled false positive by X on #N, <date> (…)` / `accepted risk` | A human ruled this fingerprint. The server copies a ruling only within the **same PR**: on this branch's PR it carries over; from another PR it does not, so it still counts. |
| `suppressed by learning <id> (AI review only)`                  | An active review learning covers it (same fingerprint, or same rule under its path glob). Learnings steer the AI review; they never clear DONE.                               |

`· would block DONE` is appended when the workspace's real policy would block the task on it (same predicate as the PR scan: an undispositioned, non-persisting finding whose provenance + severity the policy lists; default: deterministic HIGH). It is a preview — local findings have no finding id, so they cannot be ruled; push, then `lumo finding disposition` ([pr-scan.md](pr-scan.md)).

No server context is never an error — not logged in, no GitHub `origin` (pass `--repo`), a server without the security plugin (or one older than this command), a repository not linked to the workspace, or no network: the scan runs, the `Server:` line says why, and findings carry no label.

### `--pr`

With an open PR for the branch, the latest server scan of it is read (the same read as `lumo pr show`) and compared by fingerprint: findings **still reported** locally, and open server findings **fixed locally since the last push**. Only the default scope (merge-base → working tree) is compared; with `--staged` / `--since` the PR is named but not compared. AI review and hunt run on the server only — the counts point to `lumo pr show <n>` and `lumo pr review <n>`.

## Output

```
scan: 1 finding (1 high, 0 medium, 0 low)
Scope: SECRETS · origin/main (merge-base 1a2b3c4) → working tree · 6 files · 41ms
Server: acme/app · live · PR #12 · 1 would block DONE
Local results are a preview: the PR scan stays the authority for DONE.

  • [HIGH] AWS access key ID
    Rule:      secret:aws-access-key-id
    Where:     src/config.ts:2
    Evidence:  export const key = "AKIA…(len 20)"
    Server:    new · would block DONE
```

- **Line 1 is the parseable summary**, the same shape whichever scanners ran.
- Evidence is the scanner's **redacted** line; the raw value is never printed, in text or `--json`.
- A finding the scanner lowered to LOW says why (`— placeholder value, downgraded`, `— test/fixture/doc path, downgraded`).
- The `Server:` header is `live`, the cache note (`… using the context cached <time>`), or `no context — <why>`.

### `--json`

`{ version: 1, findings: [...], total, nextCursor: null, scanners, scope, filesScanned, skipped, elapsedMs, summary }` — `summary` is `{ total, high, medium, low }`; `scanners` lists the enums that ran (`SECRETS`). Declared finding fields: `scanner`, `kind` (`SECRET`), `ruleId`, `severity` (`LOW|MEDIUM|HIGH`), `title`, `filePath`, `line`, `evidence` (redacted), `fingerprint` (the server's), `detail`, `downgrade` (`PLACEHOLDER_VALUE` | `DOWNGRADED_PATH` | `null`), `server` (`null` without context, else `{ status: NEW|ON_MAIN|FALSE_POSITIVE|ACCEPTED_RISK|LEARNING, by, at, pullRequest, carriesOver, learningId, wouldBlockDone }`).

Per-commit runs (`--commit` / `--log`) add `commitSha` to each finding, and a `log` sibling with `--log` (`null` otherwise): `{ commits: [sha…], skipped, sent, created, duplicates, queued, flushed, note }`.

Server siblings: `serverContext` — `{ source: live|cache|none, note, repo, fetchedAt, pullRequest, policy, pr }` (`pr` with `--pr`: `{ number, headSha, note, stillOpen[], fixedLocally[], serverOnly: { aiReview, hunt } }`, each finding as `{ fingerprint, ruleId, severity, title, filePath, line }`; the arrays are `null` when not compared) — and `wouldBlockDone` (a count; `null` without context).

## Exit codes

| Code | Meaning                                                                                                                                                                                                                                         |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | The scan ran (findings or not) and `--fail-on` was not given or not met                                                                                                                                                                         |
| 1    | Failed: not a git repo, unknown `--since` / `--until` ref, no default branch found                                                                                                                                                              |
| 2    | Usage error: `--staged` with `--since` or `--until`, `--pr` or `--timeout` with `--offline`, an invalid `--fail-on`, `--timeout` or `--repo`; `--commit` with a scope flag; `--log` without `--commit` / `--until`, or with `--staged` / `--pr` |
| 3    | `--fail-on` met — distinct from 1 and 2 so a hook can block on findings yet fail open                                                                                                                                                           |

4 and 5 stay the confirmation and DONE gates' codes ([confirmation.md](confirmation.md)).

## Local scan log (`--log`)

Opt-in on both sides: an OWNER turns it on for the workspace (`lumo workspace security-scan update --local-scan-log on --confirm`, [workspace-settings.md](workspace-settings.md)); until then the server refuses every upload and the CLI drops it (`Log: … — local scan logging is off for this workspace`). Each scanned commit becomes one run (`POST /api/workspaces/me/security-scan/local-runs`, your normal CLI key, any member; the repository must be linked to the workspace).

- **Sent per commit:** repository, sha, first parent, `git patch-id --stable`, branch, actor (`AGENT` when a Claude Code / Codex session variable is set, with that session id — the server keeps it, and its bound task, only when the session is yours; else `USER`), trigger (`POST_COMMIT` / `PRE_PUSH` / `MANUAL`), scanners and versions, CLI version, files scanned, and per finding (at most 200, most severe first; the count covers all): scanner, fingerprint, rule, severity, file:line, the scanner's redacted title and its `Server:` label. **Never** the evidence line, a raw secret, code or the commit message. The server redacts titles again and drops any other field.
- **Dedupe:** an identical result for the same commit (same findings, labels and scanner versions) is answered `already logged` and not stored again — the pre-push run after a post-commit run costs nothing. A changed result is a new run.
- **Amend / rebase:** the patch-id stays the same when the diff does (a reworded amend, a clean rebase), so a PR head links to the runs of the same change under its old sha.
- **Offline:** no network, not logged in, a 5xx or a rate limit (30 calls a minute) → the runs are queued in `<git common dir>/lumo/scan-log-queue.json` (at most 500) and sent first by the next `--log` run that reaches the server (`… · 1 from the queue`). `--offline` queues without a call. A refusal that will not change on retry (logging off, a repository the workspace does not have, no security plugin) drops the queue.
- **Never fails the scan:** the upload outcome is the `Log:` line (and `log` in `--json`); the exit code is the scan's (`--fail-on`) only.
- **Trust:** results are client-reported and labelled **LOCAL** — nothing proves a clean local scan happened; they never block or clear DONE and cannot be ruled on. `lumo pr show` prints `⚠ Flagged locally at <sha> and pushed anyway (…)` when a run for the PR head (or the same change before an amend / rebase) had findings ([pr-scan.md](pr-scan.md)).

## Git hooks

`lumo init --scope project --scan-hooks` (opt-in; [onboarding.md](onboarding.md)) adds two managed blocks to the repo's git hooks, after any hook already there (husky / `core.hooksPath`: printed to add by hand, never written):

| Hook         | Runs                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------- |
| `pre-commit` | `lumo security scan --fail-on done --timeout 2 --staged`                                      |
| `pre-push`   | the same with `--since <remote sha> --until <local sha>` per pushed branch (from git's stdin) |

- **Blocks only on exit 3** — a finding the workspace policy would block DONE on (default: deterministic HIGH). Every other finding is printed with `lumo: warning only — not blocking the commit|push.`; a clean scan prints nothing.
- **Fails open**, saying so: exit 1 / 2 (`lumo: security scan could not run (exit N) — not blocking …`), no `lumo` on PATH (`lumo: not on PATH — … skipped`), not logged in / no network / no plugin (no server context: findings warn, `⚠ --fail-on done: no server context …`). Inside Codex's sandbox the server call fails fast and the cached context is used.
- **Time budget:** the server wait is capped at 2 s (`--timeout 2`), then the cache; the scan itself is local (typically 0.3–0.8 s a hook on a small change).
- **pre-push range:** a new branch, or a remote sha this clone has not fetched, starts at the merge-base with the default branch (`--until` alone). Branch deletions and tags are skipped. If an earlier part of the hook consumed stdin, it scans `@{upstream}` (else the merge-base) → `HEAD`.
- `git commit --no-verify` / `git push --no-verify` skip them; `lumo doctor` lists them (kind `scan-hook`), `lumo uninstall` removes only their blocks.
- **`--scan-log`** (with `--scan-hooks`) also turns on the local scan log for this repo: a `post-commit` block (`# >>> lumo post-commit >>>`) runs `lumo security scan --commit <sha> --log` with the real sha, and the `pre-push` block runs `--log` over each pushed range — both in the background (output discarded), so a commit or push never waits on it or fails because of it; `git commit --no-verify` does not skip post-commit. The switch is the repo-local git config `lumo.scanLog` (`git config lumo.scanLog false` pauses it; `lumo uninstall` unsets it with the post-commit block).

## When to suggest

- Before pushing or opening a PR — "check my changes for secrets", "did I leave a key in here?".
- After writing config, `.env`-style files, test fixtures or scripts that might hold a credential.
- In a pre-commit hook: `lumo init --scope project --scan-hooks` installs one that blocks only on what would block DONE; hand-rolled: `lumo security scan --staged --fail-on high` (add `--offline` to never wait on the network).
- "Will this block DONE?" / "is this already ruled?" before pushing — the `Server:` labels.
- After fixing findings on a PR's branch — `lumo security scan --pr` shows what the next push clears.
- "Keep a record of what was flagged before each push", "show which commits were pushed with a known secret" — the local scan log: `lumo init --scope project --scan-hooks --scan-log`, after an OWNER opted the workspace in (`--local-scan-log on`).
- Not for reading what the PR scan found — that is `lumo pr show <number>` ([pr-scan.md](pr-scan.md)).
