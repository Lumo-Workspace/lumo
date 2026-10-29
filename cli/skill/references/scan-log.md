# Local scan log — `lumo security scan --log`

Records each commit's local scan result on the Lumo server, so a PR scan can say a change was flagged locally and pushed anyway. The scan itself, its flags and output: [security-scan.md](security-scan.md).

```bash
lumo security scan --commit HEAD --log                     # record one commit (opt-in)
lumo security scan --since origin/main --until HEAD --log  # record each unpushed commit
lumo init --scan-hooks --scan-log                          # record every commit and push from git hooks
```

`--log` needs `--commit <ref>`, or `--until <ref>` (with or without `--since`) — then every non-merge commit of the range is scanned on its own (at most 50, newest kept). Not with `--staged`, `--pr` or `--full`.

## How it works

Opt-in on both sides: an OWNER turns it on for the workspace (`lumo workspace security-scan update --local-scan-log on --confirm`, [workspace-settings.md](workspace-settings.md)); until then the server refuses every upload and the CLI drops it (`Log: … — local scan logging is off for this workspace`). Each scanned commit becomes one run (`POST /api/workspaces/me/security-scan/local-runs`, your normal CLI key, any member; the repository must be linked to the workspace).

- **Scanners:** every selected scanner runs per commit (`SECRETS` on the commit's added lines, `DEPS` in fast mode on its lockfile changes; `--full` is refused). A scanner that could not finish for a commit is left out of that commit's recorded scanners.
- **Sent per commit:** repository, sha, first parent, `git patch-id --stable`, branch, actor (`AGENT` when a Claude Code / Codex session variable is set, with that session id — the server keeps it, and its bound task, only when the session is yours; else `USER`), trigger (`POST_COMMIT` / `PRE_PUSH` / `MANUAL`), scanners and versions, CLI version, files scanned, and per finding (at most 200, most severe first; the count covers all): scanner, fingerprint, rule, severity, file:line, the scanner's redacted title and its `Server:` label. **Never** the evidence line, a raw secret, code or the commit message. The server redacts titles again and drops any other field.
- **Dedupe:** an identical result for the same commit (same findings, labels and scanner versions) is answered `already logged` and not stored again — the pre-push run after a post-commit run costs nothing. A changed result is a new run.
- **Amend / rebase:** the patch-id stays the same when the diff does (a reworded amend, a clean rebase), so a PR head links to the runs of the same change under its old sha.
- **Offline:** no network, not logged in, a 5xx or a rate limit (30 calls a minute) → the runs are queued in `<git common dir>/lumo/scan-log-queue.json` (at most 500) and sent first by the next `--log` run that reaches the server (`… · 1 from the queue`). `--offline` (no network call at all) only queues. A refusal drops only what it refused: a malformed batch, or every run of a repository the workspace does not have (404); logging off for the workspace, or a server without the security plugin, drops the whole queue.
- **Never fails the scan:** the upload outcome is the `Log:` line (and `log` in `--json`); the exit code is the scan's (`--fail-on`) only.
- **Retention:** logged runs (and their findings) follow the workspace's session record setting (Settings → Data retention): a day tier deletes runs that arrived longer ago than it, used-up mode after 30 days, keep-forever keeps them; a stricter setting applies only to runs that arrive after the change. Turning the log off keeps what was logged; deleting the workspace deletes it.
- **Trust:** results are client-reported and labelled **LOCAL** — nothing proves a clean local scan happened; they never block or clear DONE and cannot be ruled on. `lumo pr show` prints `⚠ Flagged locally at <sha> and pushed anyway (…)` when a run for the PR head (or the same change before an amend / rebase) had findings ([pr-scan.md](pr-scan.md)).

## `--json`

Each finding carries `commitSha`; the `log` sibling (`null` without `--log`): `{ commits: [sha…], skipped, sent, created, duplicates, queued, flushed, note }`.

## Git hooks (`--scan-log`)

`lumo init --scan-hooks --scan-log` ([onboarding.md](onboarding.md)) turns on the local scan log for this repo: a `post-commit` block (`# >>> lumo post-commit >>>`) runs `lumo security scan --commit <sha> --log` with the real sha, and the `pre-push` block runs `--log` over each pushed range — both in the background (output discarded), so a commit or push never waits on it or fails because of it; `git commit --no-verify` does not skip post-commit. The switch is the repo-local git config `lumo.scanLog` (`git config lumo.scanLog false` pauses it; `lumo uninstall` unsets it with the post-commit block).

## When to suggest

- "Keep a record of what was flagged before each push", "show which commits were pushed with a known secret" — the local scan log: `lumo init --scan-hooks --scan-log`, after an OWNER opted the workspace in (`--local-scan-log on`).
- "Was this PR head scanned before the push?" — `lumo pr show <number>` prints the head's local history ([pr-scan.md](pr-scan.md)).
