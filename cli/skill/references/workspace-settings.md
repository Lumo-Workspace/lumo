# Workspace settings

### `lumo workspace security-scan show` / `update` — PR security-scan switches

`show` reads and `update` changes (`update` with no setting exits 2) the workspace's PR security-scan switches — the same switches as Settings → **Code review → Review behavior** in the web app (where some carry plainer names — e.g. the hunt is "Exploitability check", agent behavior is "Agent shortcut check"):

- **Security scan** (master) — off = no layer runs on new pushes and no scan comment is posted.
- **AI review** (**off for a new workspace**; workspaces created before LUM-1328 keep their value) — LLM security review, change summary, false-positive suggestions, semantic rules, claim checks and AI triage of boundary crossings. The default security review is the developer's own agent review, imported with `lumo review import` ([security-scan.md](security-scan.md)).
- **Exploit-path hunt** (**off for a new workspace**, like AI review) — sandboxed AI agent confirming exploitability.
- **Agent behavior** (`--reward-hack`, **on by default**, its platform rollout stage is the ceiling — only workspaces it has rolled out to see the switch) — reads the agent sessions behind a PR's task and flags, as advisory `[AGENT]` findings, an agent that gamed tests, metrics or checks instead of doing the task (never blocking; evidence only in the web task record). Our per-workspace monthly spend cap stops it with the layer shown as not fully checked, never as passed. `--disable-all` / `--enable-all` include it.
- **Request-changes workflow** (**off by default**, not a layer) — Lumo's PR review reads "Changes requested" while a Lumo thread or a finding that blocks Done is open, and Lumo approves once its complete review of the latest commit leaves nothing open (details: [pr-scan.md](pr-scan.md#request-changes-workflow)). Turning it **off** dismisses Lumo's standing "Changes requested" reviews on the workspace's open PRs (in the background, a missed PR at its next review; people's reviews untouched; no approval) — the exit-4 envelope says so. `--disable-all` / `--enable-all` leave it unchanged.
- **PR authors may resolve / approve by command** (**on by default**, not a layer) — the PR's author (with write access) may run `@uselumo resolve` and `@uselumo approve` on their own PR; off, only other write-access accounts may ([pr-scan.md](pr-scan.md)). Approve's preconditions (request-changes on, no blocking finding, latest head reviewed) and resolve never clearing a blocking finding are unchanged. `--disable-all` / `--enable-all` leave it unchanged.
- **Learnings scope** (`local | global | auto`, **default `auto`**, not a layer) — which repositories' PR-review learnings (what reviewers told Lumo in review threads) the AI review reads. `local` = the reviewed repository only; `global` = every repository of this workspace (never another workspace); `auto` = local for a public repository, global for a private one — the visibility is read live from GitHub at review time, and when Lumo cannot read it the review stays local. Another repository's learning counts only once it is repository-wide there (its source PR merged) and relevant to the files under review; the reviewed repository's own learnings come first under the same cap (12 learnings / 4,000 characters). `--disable-all` / `--enable-all` leave it unchanged.
- **Automatic review pause-after** (`0..100`, **default `5`**, not a layer) — every push to an open PR gets an automatic incremental AI review (and exploit-path hunt) until this many commits of that PR have been reviewed; then automatic review pauses until someone asks for a review or resumes (`lumo pr review --resume`, `@uselumo resume`). `0` = never pause. A PR's own `--resume --limit N` wins over it. Reviewed commits = the commits each reviewed push added (the first automatic review counts one commit; resume counts from the PR's current commits). An hourly cap per PR author also applies (20 automatic reviews per hour); a push over it is marked rate-limited and the next push after the hour is reviewed. `--disable-all` / `--enable-all` leave it unchanged.
- **Imported agent reviews block Done** (`--agent-review-blocks off|high|medium|low`, **default `off`**, not a layer) — whether findings imported with `lumo review import` (rule ids `ext:claude-code:…` / `ext:codex:…`, [security-scan.md](security-scan.md)) block Done: `high` = HIGH, `medium` = MEDIUM and HIGH, `low` = every severity; off = advisory only. It sets only the `AGENT_REVIEW` entries of the workspace's Done policy (`securityPolicy`); every other entry is kept. A set of entries that is no single level (written through the raw API) reads `custom` until an owner picks one. `--disable-all` / `--enable-all` leave it unchanged.

The platform env is the ceiling: a workspace can only turn a layer off, never on past it (the `Platform` column; `-` = no platform switch). `Runs` is what actually runs. Any member may read; changing is **OWNER only** — anyone else gets `Error: only workspace owners can change security-scan settings` (exit 1) before any confirmation envelope. Changes from either surface write the same `workspace.security_settings_updated` audit event: source `CLI` for this command (any API-key request), `WEB` for the settings card. Agent-review blocking writes its own `workspace.agent_review_blocking_updated` event instead (`{ from, to }` levels plus the policy before and after); it is written as a compare-and-set, so a policy edit made at the same moment is kept, and one that keeps changing it fails with 409 (try again).

```bash
lumo workspace security-scan show
lumo workspace security-scan update --disable-all
lumo workspace security-scan update --enable-all
lumo workspace security-scan update --hunt off --ai-review on
lumo workspace security-scan update --reward-hack off --confirm      # after the user approved the envelope
lumo workspace security-scan update --request-changes on --confirm   # after the user approved the envelope
lumo workspace security-scan update --allow-author-approval off --confirm  # after the user approved the envelope
lumo workspace security-scan update --learnings-scope local           # local | global | auto
lumo workspace security-scan update --learnings-scope global --confirm  # after the user approved the envelope
lumo workspace security-scan update --auto-pause-after 0              # review every push, never pause (default 5)
lumo workspace security-scan update --agent-review-blocks medium --confirm  # after the user approved the envelope
lumo workspace security-scan show --json
```

```
Layer                     Setting  Platform  Runs
Security scan (master)    on       -         yes
Managed scanners (L1/L2)  on       on        yes
AI review                 on       -         yes
Exploit-path hunt         on       off       no
Agent behavior            on       off       no

Request-changes workflow: off
Learnings scope: auto
Imported agent reviews block Done: off (advisory only)
Automatic review: every push · pauses after 5 reviewed commits
```

Flags:

- `--scan <on|off>`, `--ai-review <on|off>`, `--hunt <on|off>`, `--reward-hack <on|off>`, `--request-changes <on|off>`, `--allow-author-approval <on|off>` — set single switches (`true`/`false` also accepted).
- `--learnings-scope <local|global|auto>` — the learnings scope (case-insensitive; anything else is an error, exit 1).
- `--auto-pause-after <n>` — pause automatic review of a PR after `n` reviewed commits, a whole number `0..100` (`0` = never pause; anything else is an error, exit 1). No confirmation needed. The line reads `Automatic review: every push · never pauses` for `0`.
- `--local-scan-log <on|off>` — let members' CLIs record each commit's local scan result on the server (`lumo security scan --log`, the `--scan-log` git hooks; [security-scan.md](scan-log.md)). Default **off**: it stores metadata of commits nobody pushed yet (sha, branch, file paths, rule ids, fingerprints, redacted titles — never code, secret values or commit messages), so turning it **on** is gated (exit 4 without `--confirm`); off is not. Off stops new uploads; runs already logged stay (they follow the session record retention). Shown as `Local scan log (per commit): on|off`.
- `--agent-review-blocks <off|high|medium|low>` — which imported agent-review findings block Done (case-insensitive; anything else is an error, exit 1). **Any change is gated** (exit 4 envelope listing `off → …`; widening blocks members' tasks, narrowing lets imported findings through as advisory); the level already stored needs none. A server older than the setting refuses it with `Error: this Lumo server does not support --agent-review-blocks yet.` (exit 1) and `show` prints no line for it.
- `--disable-all` / `--enable-all` — every layer switch at once (not the request-changes workflow, author approval, the learnings scope, the pause-after, the local scan log or agent-review blocking); cannot be combined with each other or with the single-switch flags.
- **Turning anything off — and turning the request-changes workflow or author approval on, or switching the learnings scope to `global` — is gated** by the confirmation protocol ([confirmation.md](confirmation.md)): without `--confirm` it exits 4 with an envelope listing each change and sends nothing (`global` lets a public repository's publicly posted review draw on private repositories' learnings; the settings card shows the same warning while `Global` is selected). Turning layer switches on, and `--learnings-scope local` / `auto`, need no confirmation.
- `--json` prints `{ switches: { securityScanEnabled, securityAiReviewEnabled, securityHuntEnabled, securityRewardHackEnabled, securityRequestChangesEnabled, securityAllowAuthorApproval, securityLearningsScope, securityReviewAutoPauseAfter, securityLocalScanLogEnabled }, platform: { managedScan, hunt, rewardHack, sandbox }, effective: { scan, managedScan, aiReview, hunt, rewardHack, aiReviewTurnedOff, huntTurnedOff, rewardHackTurnedOff }, canEdit, agentReviewBlocking }` (`canEdit` = the caller is an OWNER; `agentReviewBlocking` = `off|high|medium|low|custom`).
- On a server without the security plugin (e.g. a self-hosted open-source build) the command prints ``Error: `lumo workspace security-scan` is not available on this Lumo server — the security plugin is not installed there.`` and exits 1 (CLI ≥ 1.106.0); there are no switches to show or change.

### `lumo workspace done-requirements show` / `update` — what DONE requires

Two OWNER switches, **both off by default**, the same as Settings → **Workflow → Done requirements**. While one is on, every task with a linked PR (closed-unmerged PRs don't count) is refused DONE (409 / exit 5 `DONE_REQUIREMENT`, [confirmation.md](confirmation.md)) until **each** such PR has, on its latest commit:

- **`--test-case on`** — a test case whose **latest** run is PASS (not capped UNPROVEN), on a clean tree, at the PR's head or merge commit, recorded against that PR or no PR ([test-case-runs.md](test-case-runs.md)).
- **`--review on`** — a review of the head: Lumo's AI review ran on it, an agent review was imported into it (`lumo review import`), or a GitHub approval on that commit from a person (not a bot) who is the repo owner, a collaborator or a member of the owning org, that was not later dismissed or followed by that reviewer's change request.

A push moves the head, so both must be met again. `update` with no flag exits 2; **every change is exit-4 gated** (workspace-wide); a value already stored is a no-op. A non-owner gets `Error: only workspace owners can change the Done requirements` (exit 1). Audited as `workspace.security_settings_updated`. `--json` prints `{ testCase, review, canEdit }`.

```bash
lumo workspace done-requirements show
lumo workspace done-requirements update --test-case on --review on --confirm  # after the user approved the envelope
```

### Per-repository automatic review — `--repos` / `--repo`

Lumo reviews every PR of each repository the workspace confirmed, including PRs **without a Lumo task**. Per repository (Settings → **Code review → Repositories**): `Review` (default on) — whether task-less PRs are reviewed automatically; `Drafts` (default off) — whether drafts are reviewed before they are marked ready. Task-linked PRs are always scanned (Done checks their findings).

```bash
lumo workspace security-scan show --repos                                  # list every connected repository
lumo workspace security-scan show --repo acme/app                          # one repository
lumo workspace security-scan update --repo acme/app --review off             # exit 4 envelope until --confirm
lumo workspace security-scan update --repo acme/app --drafts on              # turning on needs no confirmation
lumo workspace security-scan show --repos --json                           # { version, repositories: [{ repo, autoReview, reviewDrafts }], canEdit }
```

```
Repository  Review  Drafts
acme/app    on      off
acme/web    off     off
```

- `--review <on|off>` / `--drafts <on|off>` need `--repo`; neither combines with the switch flags (`--scan`, `--ai-review`, `--hunt`, `--reward-hack`, `--request-changes`, `--allow-author-approval`, `--learnings-scope`, `--auto-pause-after`, `--agent-review-blocks`, `--disable-all`, `--enable-all`).
- A repository the workspace has not connected → `Error: repository … is not connected to this workspace` (exit 1).
- Turning `--review` or `--drafts` **off** is gated by the confirmation protocol (exit 4, nothing sent); OWNER only, refused before any envelope for anyone else. Each change writes a `repository.review_settings_updated` audit event (target `repository`, `{ repo, from, to }`).

Per-repository filters, pre-merge checks, review style, the PR summary and diagrams: [repo-review-settings.md](repo-review-settings.md).

PR-review learnings are read with `lumo memory list --learnings [--repo owner/name]` — see [memory.md](memory.md#pr-review-learnings--lumo-memory-list---learnings).

### When to suggest `workspace security-scan show` / `update`

- "Turn off / pause code scanning", "stop the AI review on our PRs", "why didn't the hunt run" — and the user is a workspace owner (reading is open to anyone).
- "Don't review PRs in repo X", "review drafts too", "why was my PR without a task (not) reviewed" → `--repos` / `--repo`.
- "Skip WIP PRs", "don't review dependabot", "only review PRs labelled X", "review PRs into release branches", "ignore lockfiles / generated files", "auto-review filters / path filters" → the filter flags with `--repo`.
- "Too many review comments", "only comment on serious issues", "show nitpicks too", "review in a friendlier / terser tone", "tell the review to check X in folder Y" → `--profile` / `--tone` / `--path-instruction` with `--repo`.
- "Don't edit our PR descriptions", "put the PR summary in the description", "turn the PR summary off" → `--summary description|comment|off` with `--repo`.
- "No diagrams in PR comments", "turn sequence diagrams on/off" → `--sequence-diagrams on|off` with `--repo`.
- "Make Lumo request changes / approve PRs", "request changes on open findings" → `--request-changes on` (exits 4 first; relay the envelope).
- "Stop PR authors approving their own PRs via @uselumo", "allow_author_approval" → `--allow-author-approval off` (exits 4 first; relay the envelope); turning it back on is gated too.
- "What has Lumo learned from our review replies", "delete that learning", "undo a learning on a repo without a project" → `lumo memory list --learnings [--repo]`, then `lumo memory delete <ref>` (exits 4 first; relay the envelope).
- "Use learnings from our other repos", "keep each repo's learnings separate", "share learnings across repositories" → `--learnings-scope global|local|auto` (`global` exits 4 first; relay the envelope).
- "Review every push", "stop pausing reviews after a few pushes", "pause automatic review after N reviewed commits" → `--auto-pause-after <n>` (`0` = never pause).
- "Make our Claude Code / Codex security reviews block Done", "imported findings should block", "stop imported findings blocking" → `--agent-review-blocks high|medium|low|off` (exits 4 first; relay the envelope).
- **Never** turn a switch off on your own initiative (e.g. to make findings go away): relay the exit-4 envelope and let the user decide. Earlier blocking findings still block Done either way.
