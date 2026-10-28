# Local security scans — `lumo security scan` / `import`

`lumo security scan` runs Lumo's security scanners **on this machine, on your uncommitted and unpushed changes**, so a problem is caught before it reaches a PR. It is read-only: nothing is uploaded, no task or finding changes (the only write is the server-context cache under `~/.lumo/cache/scan-context/`). The PR scan stays the only authority for DONE — a clean local scan never clears a gate, and a local finding never blocks one.

Scanners today: `SECRETS` (`--secrets`) and `DEPS` (`--deps`). With no scanner flag, every local scanner runs.

## What `SECRETS` checks

The **same deterministic secret scanner as the PR scan's first stage** (the code lives in `shared/src/secret-scan/`; the server imports the identical module), over the lines your changes add. No network, no binary, typically well under a second. Findings carry the server's fingerprints, so a local finding is the same finding the PR scan will report.

## What `DEPS` checks

Known-vulnerable and **known-malicious** dependencies, with the managed PR scan's identity (osv-scanner's advisory ids; rule `ext:osv-scanner:<id>`, the server's dependency fingerprint).

- **Fast (default)** — diffs every npm `package-lock.json` / `npm-shrinkwrap.json` between the scope's base and head, and looks up **only the added or re-versioned packages** on the OSV API. No binary; typically under a second when nothing changed, a few seconds for a whole lockfile. Other ecosystems' lockfiles (`yarn.lock`, `pnpm-lock.yaml`, `go.sum`, `requirements.txt`, …) are not read in fast mode: a changed one is listed on a `Not checked …` line — use `--full`.
- **`--full`** — runs **osv-scanner from your PATH** (`osv-scanner scan source -r . --format json`) over the whole working tree, every ecosystem, pre-existing debt included (`--staged` / `--since` do not narrow it). If osv-scanner is not installed it exits 1 with install instructions (`brew install osv-scanner`, `go install …`, release binaries). Lumo never downloads a binary.
- **`--offline`** — no network call at all (the same flag also keeps the server context to its cache, below): osv-scanner's local database instead of the API (fast mode runs it on the changed lockfiles and keeps the changed packages). Needs osv-scanner and its database (`osv-scanner scan source --offline-vulnerabilities --download-offline-databases -r .` fetches it once); without them, when a lockfile changed, DEPS is reported incomplete and the other scanners still run. No lockfile change = no osv-scanner needed.
- **Privacy:** fast mode sends **package names, versions and the ecosystem** to `api.osv.dev` (Google's OSV service) — nothing else: no code, paths or repository name. Use `--offline` when that is not acceptable.
- **`MAL-*` advisories (known-malicious packages) are always HIGH** and get their own `MALICIOUS: …` line; remove the package and rotate any credential it could have read.
- Each finding suggests the **fixed version** (the lowest release that fixes every advisory in its group), or says none is published.
- **`osv-scanner.toml` ignores are honoured**, by id or alias, from the file next to each lockfile (as osv-scanner reads it): suppressed advisories are listed on an `Ignored by osv-scanner.toml: …` line. Once an entry's `ignoreUntil` passes, the advisory is reported again with `— osv-scanner.toml ignore expired <date>`.
- Severity: `MAL-*` HIGH; else the CVSS v3 base score (≥7 HIGH, ≥4 MEDIUM, else LOW, as the PR scan maps it); else the advisory's own label; else MEDIUM.
- **Incomplete, never clean:** when the OSV API is unreachable, times out (10 s per request) or answers badly — or a lockfile is not valid JSON — line 1 ends `· incomplete: DEPS`, an `Incomplete: DEPS — …` line says why, and the exit code is 1.

## Flags

- `--secrets` — Run the secret scanner. No scanner flag = every local scanner.
- `--deps` — Run the dependency scanner (fast mode). Sends changed package names and versions to `api.osv.dev`.
- `--full` — `DEPS` runs osv-scanner from PATH over the whole tree instead of the lockfile delta. Not with `--secrets` alone (exit 2).
- _(no scope flag)_ — From the merge-base with the default branch (`origin/HEAD`, else `origin/main` / `origin/master`) to the **working tree**: committed, staged and unstaged edits, plus untracked files (not ignored ones).
- `--staged` — Only the index (`git diff --cached`) — what the next commit will contain. For a pre-commit hook. Untracked files are not read.
- `--since <ref>` — From `<ref>` (as given, not its merge-base) to the working tree, untracked files included. Not with `--staged`.
- `--until <ref>` — End at this commit instead of the working tree: only committed changes, no untracked files (`DEPS` reads the lockfiles of that commit). With `--since` the range is `<since>` → `<until>`; alone it starts at the merge-base of `<until>` with the default branch. Not with `--staged`. For a pre-push hook.
- `--fail-on <level>` — `low` | `medium` | `high` (case-insensitive): exit **3** when any finding is at or above it. `done`: exit 3 when a finding **would block DONE** under the workspace policy (the `Server:` label below) — without server context nothing can, so it never exits 3 and says so on stderr.
- `--json` — The list envelope (below).
- `--offline` — Make **no network call**: labels come from the cached server context only (no cache yet = no labels), and `DEPS` uses osv-scanner's local database instead of api.osv.dev. Not with `--pr`.
- `--timeout <seconds>` — Wait at most this long for the network (more than 0, at most 60): the Lumo server (default 8, then the cached context) and the whole api.osv.dev lookup (default 10 per request; past the budget `DEPS` is incomplete). Not with `--offline`.
- `--pr` — When the branch has an open PR: merge in that PR's latest server scan — its findings you fixed locally since the last push vs those still reported, and the server-only layers (AI review, hunt).
- `--repo <owner/repo>` — The repository to read server context for, instead of the one `origin` points at (a fork's origin, a non-GitHub remote).

```bash
lumo security scan
lumo security scan --secrets --staged --fail-on high
lumo security scan --since origin/main --json
lumo security scan --deps --fail-on high
lumo security scan --deps --full
lumo security scan --pr
lumo security scan --staged --offline --fail-on high
lumo security scan --staged --fail-on done --timeout 2     # what the pre-commit hook runs
lumo security scan --since origin/feature --until HEAD     # the commits a push would send
```

Run it from anywhere inside the repository; paths are repo-relative. Untracked files that are binary, symlinks, unreadable or over 2 MiB are skipped and listed on a `Skipped …` line.

## Server context

Each run asks the Lumo server what it already knows about this repository (`GET /api/workspaces/me/security-scan/context`, any workspace member): the default branch's **baseline** fingerprints, human **rulings** (false positive / accepted risk — who, when, on which PR), the active **review learnings** in the workspace's learnings scope, the workspace **security policy**, and the branch's open PR. Fingerprints, rule ids and statuses only — never code or evidence. It is cached by ETag under `~/.lumo/cache/scan-context/`; `--offline` reads only the cache, and an unreachable server falls back to it.

A renamed repository (your `origin` still has the old name) is found under its current name when Lumo recorded the rename: the `Server:` line names the current repository and is followed by the same `Note: …` lines as `import` (the remote fix, or `--repo <new>` when the old name came from `--repo`); otherwise use `--repo`.

**What it sends:** two read-only `GET`s with no body. The context request carries only the repository (`owner/name`, from `origin` or `--repo`) and the checked-out branch name. With `--pr`, a second request carries that repository and the PR number the server returned (the `lumo pr show` read). No file path, line, fingerprint, evidence or file content leaves the machine; labelling happens locally. Inside Codex's no-network sandbox the requests fail fast, and the scan falls back to the cache, or to no context, with exit 0.

Each finding then gets a `Server:` label:

- `new` — The server knows nothing about this fingerprint.
- `already on main` — In the default branch's baseline — persisting, never this PR's to block on.
- `ruled false positive by X on #N, <date> (…)` / `accepted risk` — A human ruled this fingerprint. The server copies a ruling only within the **same PR**: on this branch's PR it carries over; from another PR it does not, so it still counts.
- `suppressed by learning <id> (AI review only)` — An active review learning covers it (same fingerprint, or same rule under its path glob). Learnings steer the AI review; they never clear DONE.

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

- With `DEPS`, a `Deps: …` line says what was checked and against what (`2 added or changed packages in package-lock.json checked against api.osv.dev`, or `osv-scanner, whole tree`); a DEPS finding shows `Package`, `Where` (the lockfile), `Fix` and `Advisory` (its osv.dev page) instead of a line and evidence. Its `Server:` label works the same way: the default branch's baseline holds the managed scan's dependency fingerprints, so an advisory already on main reads `already on main`.

```
scan: 1 finding (1 high, 0 medium, 0 low)
Scope: SECRETS, DEPS · origin/main (merge-base 1a2b3c4) → working tree · 3 files · 412ms
Deps: 2 added or changed packages in package-lock.json checked against api.osv.dev
Server: acme/app · live · 0 would block DONE
Local results are a preview: the PR scan stays the authority for DONE.

  • [HIGH] Command Injection in lodash
    Rule:      ext:osv-scanner:GHSA-35jh-r3h4-6jhm
    Package:   lodash@4.17.15 (npm)
    Where:     package-lock.json
    Fix:       upgrade to 4.17.21 or later
    Advisory:  https://osv.dev/vulnerability/GHSA-35jh-r3h4-6jhm
    Server:    already on main
```

### `--json`

`{ version: 1, findings: [...], total, nextCursor: null, scanners, scope, filesScanned, skipped, elapsedMs, summary, complete, incomplete, deps, serverContext, wouldBlockDone }` — `summary` is `{ total, high, medium, low }`; `scanners` lists the enums that ran (`SECRETS`, `DEPS`); `complete` is false when any scanner could not finish, and `incomplete` lists `{ scanner, reason }`; `deps` is `{ mode: fast|full, source, lockfiles, packagesChecked, ignored[], notCovered[] }` or `null` when DEPS did not run.

Declared finding fields: `scanner`, `kind` (`SECRET` | `DEPENDENCY`), `ruleId`, `severity` (`LOW|MEDIUM|HIGH`), `title`, `filePath`, `line` (`null` for DEPENDENCY), `evidence` (redacted; `null` for DEPENDENCY), `fingerprint` (the server's), `detail`, `downgrade` (`PLACEHOLDER_VALUE` | `DOWNGRADED_PATH` | `null`), `server` (`null` without context, else `{ status: NEW|ON_MAIN|FALSE_POSITIVE|ACCEPTED_RISK|LEARNING, by, at, pullRequest, carriesOver, learningId, wouldBlockDone }`). A DEPENDENCY finding adds `dependency: { ecosystem, name, version, osvId, aliases, malicious, fixedVersion, score, url, ignoreExpired }`.

Server siblings: `serverContext` — `{ source: live|cache|none, note, repo, renamedFrom, fetchedAt, pullRequest, policy, pr }` (`renamedFrom`: the remote's old name when Lumo followed a rename, else `null`) (`pr` with `--pr`: `{ number, headSha, note, stillOpen[], fixedLocally[], serverOnly: { aiReview, hunt } }`, each finding as `{ fingerprint, ruleId, severity, title, filePath, line }`; the arrays are `null` when not compared) — and `wouldBlockDone` (a count; `null` without context).

## Exit codes

- 0 — The scan ran (findings or not) and `--fail-on` was not given or not met
- 1 — Failed: not a git repo, unknown `--since` / `--until` ref, no default branch found; osv-scanner missing for `--full`; or a scanner could not finish (`DEPS` with the OSV API unreachable or past `--timeout`, or `--offline` without osv-scanner or its database) — the report still prints, marked incomplete
- 2 — Usage error: `--staged` with `--since` or `--until`, `--pr` or `--timeout` with `--offline`, `--full` without `DEPS`, an invalid `--fail-on`, `--timeout` or `--repo`
- 3 — `--fail-on` met — distinct from 1 and 2 so a hook can block on findings yet fail open

4 and 5 stay the confirmation and DONE gates' codes ([confirmation.md](confirmation.md)).

## Git hooks

`lumo init --scan-hooks` (opt-in; [onboarding.md](onboarding.md)) adds two managed blocks to the repo's git hooks, after any hook already there (husky / `core.hooksPath`: printed to add by hand, never written):

- `pre-commit` — `lumo security scan --fail-on done --timeout 2 --secrets --staged`
- `pre-push` — `lumo security scan --fail-on done --timeout 2 --since <remote sha> --until <local sha>` per pushed branch (from git's stdin) — every local scanner

- **Blocks only on exit 3** — a finding the workspace policy would block DONE on (default: deterministic HIGH). Every other finding is printed with `lumo: warning only — not blocking the commit|push.`; a clean scan prints nothing.
- **Fails open**, saying so: exit 1 / 2 (`lumo: security scan could not run (exit N) — not blocking …`), no `lumo` on PATH (`lumo: not on PATH — … skipped`), not logged in / no network / no plugin (no server context: findings warn, `⚠ --fail-on done: no server context …`). Inside Codex's sandbox the server call fails fast and the cached context is used.
- **Scanners:** pre-commit runs `SECRETS` only (`--secrets`), so the hook on every commit never calls api.osv.dev. pre-push runs every local scanner, `DEPS` included, for the lockfiles the pushed commits change — that sends their new package names / versions to api.osv.dev; no lockfile change, no `DEPS` call. A `DEPS` lookup that cannot finish (OSV unreachable, past the budget) makes the scan exit 1, so the hook says so and does not block, unless another finding already blocks (exit 3 wins).
- **Time budget:** `--timeout 2` caps each network wait — the Lumo server (then the cache) and the whole api.osv.dev lookup; the rest is local (typically 0.3–0.8 s a hook on a small change).
- **pre-push range:** a new branch, or a remote sha this clone has not fetched, starts at the merge-base with the default branch (`--until` alone). Branch deletions and tags are skipped. If an earlier part of the hook consumed stdin, it scans `@{upstream}` (else the merge-base) → `HEAD`.
- `git commit --no-verify` / `git push --no-verify` skip them; `lumo doctor` lists them (kind `scan-hook`), `lumo uninstall` removes only their blocks.

## When to suggest

- Before pushing or opening a PR — "check my changes for secrets", "did I leave a key in here?".
- After writing config, `.env`-style files, test fixtures or scripts that might hold a credential.
- In a pre-commit hook: `lumo init --scan-hooks` installs one that blocks only on what would block DONE; hand-rolled: `lumo security scan --staged --fail-on high` (add `--offline` to never wait on the network).
- "Will this block DONE?" / "is this already ruled?" before pushing — the `Server:` labels.
- After fixing findings on a PR's branch — `lumo security scan --pr` shows what the next push clears.
- After `npm install` / a dependency bump, or before pushing a lockfile change — "did that upgrade pull in anything vulnerable?": `lumo security scan --deps`.
- For the whole tree or a non-npm project: `lumo security scan --deps --full` (needs osv-scanner on PATH).
- Not for reading what the PR scan found — that is `lumo pr show <number>` ([pr-scan.md](pr-scan.md)).

## `lumo security import <file>` — attach a Claude Code / Codex review

Attaches a security review **you ran in Claude Code or Codex** to the branch's open PR scan, so its findings show in `lumo pr show`, on the PR and in the task record, and can be ruled with `lumo finding disposition`. Lumo runs no model for it; the review is yours.

- **Advisory, never blocks DONE**, whatever the workspace policy lists (rule ids `ext:claude-code:…` / `ext:codex:…`).
- **Renamed repository.** The repository is read from your `origin` remote, which keeps the old name after a GitHub rename. Lumo remembers renames made while the repository was confirmed and imports into the current name, printing `Note: <old> was renamed to <new>. Update your git remote:` and a `git remote set-url origin …` command that keeps your remote's form (https or ssh; credentials in an https URL are never printed — the command leaves them out and says so). When the old name came from `--repo` it says to pass `--repo <new>` instead. A rename from before Lumo kept that record: pass `--repo <owner/new-name>`.
- **Pushed code only.** The PR must be open and its head must be your `HEAD` (else exit 1, "push first"; right after a push, wait a few seconds for Lumo to see it). Lumo keeps only results on lines the PR changed; the rest are dropped.
- **Replaces** that tool's earlier import on the same head; an empty `findings` list clears it. It runs in the background: the result shows in `lumo pr show <n>` within a minute.
- **Sends** the report (titles, details, paths, lines) to Lumo; it is redacted like a CI report. Any workspace member may import into the workspace's PRs.

**File format** — SARIF 2.1.0 as is (e.g. a Codex Security `export --export-format sarif`), or:

```json
{
  "findings": [
    {
      "file": "app/api/search/route.ts",
      "line": 12,
      "severity": "high",
      "title": "SQL injection in search",
      "detail": "q reaches $queryRawUnsafe",
      "rule": "sql-injection"
    }
  ]
}
```

`file` repo-relative (an absolute path inside the repo is accepted), `line` ≥ 1, `severity` `high` | `medium` | `low` (`critical` = high), `title` required, `detail` and `rule` optional (a category such as `sql-injection`, or a CWE such as `CWE-89`; no `rule` = a slug of the title; keep it stable so a re-import keeps the finding's fingerprint and its ruling). A finding on the same line as Lumo's own AI review or hunt report of the same kind of issue (or another agent's) is listed under that one PR thread instead of opening a second. At most 500 findings, 1 MiB.

**Getting the file.** Claude Code: run `/security-review`, then write its findings to a file in this format (e.g. `/tmp/review.json`). Codex: run the review, write the findings the same way, or export SARIF.

Flags: `--tool claude-code|codex` (default: the agent this shell runs in; required elsewhere), `--pr <number>` (instead of the branch's open PR), `--repo <owner/repo>`, `--json` (`{ version, runId, repository, prNumber, headSha, tool, results, renamedFrom? }` — `renamedFrom` is the name you sent when Lumo followed a rename; `repository` is then the current name).

```bash
lumo security import /tmp/review.json
lumo security import results.sarif --tool codex --pr 42
```

Exit codes: 0 sent · 1 not logged in, no open PR, `HEAD` not the PR head, unreadable or invalid file (the reason names the field, e.g. `findings[0].severity`), or the server refused (repository not confirmed, scanning off, PR not open, rate limit) · 2 usage (`--tool` missing outside an agent or not an agent, bad `--pr` / `--repo`). In Codex it reads a local file, so Codex asks first ([codex.md](codex.md)).

**When to suggest:** the user asks you to security-review the branch, or ran `/security-review`, and the PR is open and pushed — offer to import the findings; never import without saying so.
