# Pull requests by number — `lumo pr show` / `lumo pr review`

`lumo pr show <number>` prints the **security scans of one PR** in the workspace, by PR number — whether or not a task is linked to it. `lumo task status` only shows one summary line per _linked_ PR; a PR without `[LUM-N]` in its title and not on a `lumo/LUM-N-…` branch is visible only here.

`pr show` is read-only, no LLM; requesting or pausing a review is `lumo pr review`. It reports dispositions, it never records one — the user's ruling goes through [`lumo finding disposition`](#finding-disposition) (or the web panel). How to read the output: [pr-scan-output.md](pr-scan-output.md).

```bash
lumo pr show 1013                                 # latest head's scan, prose
lumo pr show 1013 --full                          # + per-task hunt detail
lumo pr show 1013 --all                           # every pushed head, newest first
lumo pr show 1013 --json                          # structured payload (version 1)
lumo pr show 1013 --repo Lumo-Workspace/lumo      # same number in several repos
lumo pr review 1013                               # request an incremental AI review now
lumo pr review 1013 --full                        # request a full AI review
lumo pr review 1013 --pause                       # pause automatic review of every push
lumo pr review 1013 --repo owner/repo --resume --limit 2
```

- `--repo <owner/repo>` — only needed when the workspace has the same PR number in several repos (the command then exits 1 and lists one `--repo` line per candidate).
- `--all` — every head's scan, newest first (default: the latest head only).
- `--full` — adds the hunt header and per-task detail (commands, step trace, `stop:` arithmetic, sites, model).
- The PR is resolved **inside the caller's workspace**: a number of another workspace is indistinguishable from one that never existed (`Error: PR #N not found in workspace <slug>`).

## Which PRs are reviewed automatically

Every open PR of a repository the workspace confirmed is reviewed on open / reopen / push / ready-for-review — task-linked or not. **Task-linked PRs are always scanned** (the scan is the Done gate's evidence). For a PR **without a task** the per-repository settings apply ([workspace-settings.md](workspace-settings.md), [repo-review-settings.md](repo-review-settings.md)): a repository turned off is not reviewed unless the PR opts in (label / description keyword), its auto-review filters and path filters apply, and drafts are skipped unless the repository includes them. When several workspaces confirmed one repository, exactly one reviews a task-less PR. `lumo pr review <n> --full` reviews any PR by hand.

## Review controls — `lumo pr review`

- Every push to an open PR gets an automatic incremental AI review (and exploit-path hunt) until the PR has N reviewed commits (auto-pause): N is the PR's own `--limit`, else the workspace's `--auto-pause-after` (default 5, `0` = never pause). An hourly cap per PR author (20 automatic reviews) also applies; a manual review is never limited.
- `lumo pr review <n>` requests an incremental review (files changed since the last complete AI review); `--full` the entire PR. Both bypass the automatic budget without consuming it. Concurrent requests deduplicate. A request while the head's scan is still running waits for it (up to 10 minutes) and runs once if that scan's AI review was held.
- `--pause` pauses automatic AI review and the hunt. `--resume` resets the reviewed-commit count and resumes automatic review (it does not review the current head immediately). `--limit 1..100` with pause/resume gives the PR its own pause-after. Deterministic checks continue while AI is paused. **Paused does not mean checked and does not clear blocking findings.**
- At most one of `--full`, `--pause`, `--resume` (`--limit` only with `--pause` / `--resume`; anything else exits 2).
- Use these when repeated fix pushes keep triggering new AI findings, or when the user asks for a manual review / pause / resume.

## PR comment commands

A top-level PR comment starting with the App's handle (production `@uselumo`) — only accounts with write access are obeyed; bots and edited comments are ignored:

- `@uselumo review` / `full review` / `pause` / `resume` — same as `lumo pr review` and its flags.
- `@uselumo resolve` — resolves Lumo's open review threads as the commenter's own resolve. It **never dispositions a finding** and leaves a finding that blocks DONE open (clear those with `lumo finding disposition` or the web panel). Open to the PR's author unless the workspace turned author approval off.
- `@uselumo approve` — only with the request-changes workflow on: resolves Lumo's threads and approves the current head. **Refused while any finding blocks DONE** (resolving a thread on GitHub does not clear it — only a disposition does), until Lumo's latest scan is of the current head, and while a failed `error` pre-merge check is not overridden.
- `@uselumo configuration` — replies with the effective review settings and their source (`.lumo.yaml` on the base branch > repository settings > default). Read-only.
- `@uselumo summary` / `@uselumo diagram` — rewrite the PR summary / redraw the call-flow diagram from the latest review ([repo-review-settings.md](repo-review-settings.md)).
- `@uselumo ignore pre-merge checks` — overrides the PR's failed pre-merge checks (recorded); never clears a finding that blocks DONE.
- `@uselumo help` — the list. A short unknown word gets the help list; anything longer is a question (below).
- `@uselumo ignore` in the PR **description** (not in code or a quote) skips the automatic AI review and hunt of every push while it stays there; deterministic checks still run, and a task-linked PR keeps its DONE-gate scan. A requested review still runs.

**Questions to Lumo on a PR.** A question in a Lumo finding thread, a review-line comment mentioning `@uselumo`, or a conversation comment mentioning it (not a command) gets an answer grounded in the PR's diff. Write access only; at most 10 answers per PR per hour; a comment with a prompt-injection signal gets none. Answers are words only — they never resolve a thread, disposition a finding or approve. A reply saying a finding is intentional / not applicable becomes a PR-review learning ([memory.md](memory.md)).

## Request-changes workflow

Off by default (`lumo workspace security-scan update --request-changes on|off`, OWNER). On, Lumo's review is **Changes requested** while any Lumo thread is open, any finding blocks DONE, or an `error` pre-merge check fails and is not overridden. Lumo **approves** only when the latest head's review is complete (every enabled layer ran whole), no Lumo thread is open, no finding blocks DONE, and the head is unchanged. Turning it off dismisses Lumo's standing "Changes requested" reviews on the workspace's open PRs (people's reviews are untouched; nothing is approved). Whether Lumo's review counts toward branch protection is GitHub's call.

## Across a task — `lumo task show <task> --scans`

```bash
lumo task show LUM-42 --scans
lumo task show LUM-42 --scans --all --full
```

The same read-out for **every PR linked to a task**, newest PR first — what the web task Record's security section shows. Read-only, no LLM. Header `LUM-42 · security scans`, `PRs:  N linked · M scanned`, `Findings:  a open · b block(s) DONE (latest scan of each PR)`, then one block per PR printed exactly like `pr show` (`--all` / `--full` apply to every PR). **No linked PR** prints `⚠ No PR is linked to LUM-42 — nothing has been scanned, so it could not be confirmed clean.` — never an implicit clean. `--json`: `{ version: 1, task: { identifier }, totals: { pullRequests, scanned, open, blocking }, all, redactedSecrets, scanningOff, pullRequests: [ <pr show --json payload> ] }` (under the `task show` envelope's `scans` key).

**When to suggest:** the user asks what the scans found on a **task** ("what did security find on LUM-42", "what was already ruled") — instead of one `pr show` per PR. `lumo task status` stays the one-line summary.

## Errors

- `Error: PR #N not found in workspace <slug>` — unknown number, or a PR of another workspace (same message on purpose).
- `Error: PR #N exists in several repos — pass --repo <owner/repo>` followed by one ready-to-run `lumo pr show N --repo …` line per candidate.
- `Error: --repo must be owner/repo` — malformed flag, no request made.
- ``Error: `lumo pr show` is not available on this Lumo server — the security plugin is not installed there.`` — nothing to retry; don't suggest scan commands against that server. `task show --scans` prints the same for tasks, or `this Lumo server does not serve the task scan read-out yet — use lumo pr show <number> per PR` on an older server.

## When to suggest

- The user asks what the security scan found on a PR ("what did the scan say on #1013", "why is PR 1013 blocked") — especially a PR **without** a linked task.
- `lumo task status` shows a `PR #N · scan …` line and the user wants the findings behind it, the dispositioned history, or why a layer read `⚠ partly checked` — `lumo pr show N`, then `--full` for the hunt trace.
- **Not** for changing a finding's standing: that is `lumo finding disposition` (the user's ruling, exit-4 gated) or the web panel. **Not** `lumo task pr show` — that is the task-scoped PR card (title, state, CI, branches) without scan detail.

## Finding disposition

`lumo finding disposition <id...> --false-positive | --accepted-risk [--note "<text>"] [--task <LUM-N>] [--confirm]` records the **user's** ruling on one or more PR security findings. It is how a blocking finding is cleared for DONE; the web delivery panel stays a second surface (and can correct a CLI ruling). Resolving the GitHub review thread does **not** clear the gate.

```bash
lumo finding disposition pskvl3sh --false-positive --note "test fixture, not a real key"
lumo finding disposition pskvl3sh 6z9j2q6d --accepted-risk --note "internal-only endpoint"
```

A gated mutation on the [confirmation protocol](confirmation.md) — no read receipts, no extra steps:

- **Without `--confirm`** it reads the findings from the server and prints ONE `confirmation_required` envelope (exit 4, nothing written): one line per finding — short ref, `[SEVERITY]`, title, rule and location, PR, `blocks DONE` / `advisory`, `OPEN → <ruling>`, the note — then the ⚠ DONE consequence. Relay every line to the user.
- **Only after the user approves in chat**, run the envelope's `confirmCommand` (your command plus `--confirm`). Each finding is reported `✓` / `✗` (exit 1 if any failed), then the status digest. **Never add `--confirm` yourself.**
- Refs come from `lumo task status` (`Ref:` under each `[SECURITY]` / `[BUG]` item — the 8-char short ref) or `DONE_BLOCKED` (`blockers[].findingId` is the full id, which also works, as does a unique prefix of 6+ chars). Several refs = one envelope; one ruling per call. A ref not on the task, too short or ambiguous fails closed (exit 1, nothing written, candidates listed); a finding already carrying the ruling is skipped (a line in `changes`; plain text and exit 0 when every id was skipped).
- `--accepted-risk` means the risk is real and knowingly carried — ask the user for the why and pass it as `--note`.
- The server records each ruling with channel `CLI`, the member, the session and the time. There is no agent-session guard: the protection is the user's approval of the envelope. Reverting a ruling to OPEN is **web-only** (the panel's Reopen; the CLI gets 403): the finding then blocks DONE again. If the user says a CLI ruling was a mistake, send them to the web panel.

**When to suggest:** `lumo task status` lists a blocking `[SECURITY]` / `[BUG]` finding the user says is a false positive or an accepted risk; `task update --status done` exits 5 with a `SECURITY_FINDING` blocker; the user asks to clear, dismiss or accept a scan finding.
