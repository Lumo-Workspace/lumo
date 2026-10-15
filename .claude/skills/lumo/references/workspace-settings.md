# Workspace settings

### `lumo workspace security-scan` — PR security-scan switches (LUM-1002)

Shows or changes the workspace's PR security-scan switches — the same three as Settings → Workspace → **PR security scanning** in the web app:

- **Security scan** (master) — off = no layer runs on new pushes and no scan comment is posted.
- **AI review** — LLM security review, change summary, false-positive suggestions, semantic rules, claim checks and AI triage of boundary crossings.
- **Exploit-path hunt** — sandboxed AI agent confirming exploitability.
- **Request-changes workflow** (LUM-1130, **off by default**, not a layer) — Lumo's PR review reads "Changes requested" while a Lumo thread or a finding that blocks Done is open, and Lumo approves once its complete review of the latest commit leaves nothing open (details: [pr-scan.md](pr-scan.md#request-changes-workflow-lum-1130)). Turning it **off** dismisses Lumo's standing "Changes requested" reviews on the workspace's open PRs (LUM-1140; in the background, a missed PR at its next review; people's reviews untouched; no approval) — the exit-4 envelope says so. `--disable-all` / `--enable-all` leave it unchanged.
- **PR authors may resolve / approve by command** (LUM-1142, **on by default**, not a layer) — the PR's author (with write access) may run `@uselumo resolve` and `@uselumo approve` on their own PR; off, only other write-access accounts may ([pr-scan.md](pr-scan.md)). Approve's preconditions (request-changes on, no blocking finding, latest head reviewed) and resolve never clearing a blocking finding are unchanged. `--disable-all` / `--enable-all` leave it unchanged.
- **Learnings scope** (LUM-1134, `local | global | auto`, **default `auto`**, not a layer) — which repositories' PR-review learnings (what reviewers told Lumo in review threads, LUM-1131) the AI review reads. `local` = the reviewed repository only; `global` = every repository of this workspace (never another workspace); `auto` = local for a public repository, global for a private one — the visibility is read live from GitHub at review time, and when Lumo cannot read it the review stays local. Another repository's learning counts only once it is repository-wide there (its source PR merged) and relevant to the files under review; the reviewed repository's own learnings come first under the same cap (12 learnings / 4,000 characters). `--disable-all` / `--enable-all` leave it unchanged.
- **Automatic review pause-after** (LUM-1137, `0..100`, **default `5`**, not a layer) — every push to an open PR gets an automatic incremental AI review (and exploit-path hunt) until this many commits of that PR have been reviewed; then automatic review pauses until someone asks for a review or resumes (`lumo pr scan --resume`, `@uselumo resume`). `0` = never pause. A PR's own `--resume --limit N` wins over it. Reviewed commits = the commits each reviewed push added (the first automatic review counts one commit; resume counts from the PR's current commits). An hourly cap per PR author also applies (20 automatic reviews per hour); a push over it is marked rate-limited and the next push after the hour is reviewed. `--disable-all` / `--enable-all` leave it unchanged.

The platform env is the ceiling: a workspace can only turn a layer off, never on past it (the `Platform` column; `-` = no platform switch). `Runs` is what actually runs. Any member may read; changing is **OWNER only** — anyone else gets `Error: only workspace owners can change security-scan settings` (exit 1) before any confirmation envelope. Changes from either surface write the same `workspace.security_settings_updated` audit event: source `CLI` for this command (any API-key request), `WEB` for the settings card.

```bash
lumo workspace security-scan
lumo workspace security-scan --disable-all
lumo workspace security-scan --enable-all
lumo workspace security-scan --hunt off --ai-review on
lumo workspace security-scan --request-changes on --confirm   # after the user approved the envelope
lumo workspace security-scan --allow-author-approval off --confirm  # after the user approved the envelope
lumo workspace security-scan --learnings-scope local           # local | global | auto
lumo workspace security-scan --learnings-scope global --confirm  # after the user approved the envelope
lumo workspace security-scan --auto-pause-after 0              # review every push, never pause (default 5)
lumo workspace security-scan --json
```

```
Layer                     Setting  Platform  Runs
Security scan (master)    on       -         yes
Managed scanners (L1/L2)  on       on        yes
AI review                 on       -         yes
Exploit-path hunt         on       off       no

Request-changes workflow: off
Learnings scope: auto
Automatic review: every push · pauses after 5 reviewed commits
```

Flags:

- `--scan <on|off>`, `--ai-review <on|off>`, `--hunt <on|off>`, `--request-changes <on|off>`, `--allow-author-approval <on|off>` — set single switches (`true`/`false` also accepted).
- `--learnings-scope <local|global|auto>` — the learnings scope (case-insensitive; anything else is an error, exit 1).
- `--auto-pause-after <n>` — pause automatic review of a PR after `n` reviewed commits, a whole number `0..100` (`0` = never pause; anything else is an error, exit 1). No confirmation needed. The line reads `Automatic review: every push · never pauses` for `0`.
- `--disable-all` / `--enable-all` — every layer switch at once (not the request-changes workflow, author approval, the learnings scope or the pause-after); cannot be combined with each other or with the single-switch flags.
- **Turning anything off — and turning the request-changes workflow or author approval on, or switching the learnings scope to `global` — is gated** by the confirmation protocol ([confirmation.md](confirmation.md)): without `--confirm` it exits 4 with an envelope listing each change and sends nothing (`global` lets a public repository's publicly posted review draw on private repositories' learnings; the settings card shows the same warning while `Global` is selected). Turning layer switches on, and `--learnings-scope local` / `auto`, need no confirmation.
- `--json` prints `{ switches: { securityScanEnabled, securityAiReviewEnabled, securityHuntEnabled, securityRequestChangesEnabled, securityAllowAuthorApproval, securityLearningsScope, securityReviewAutoPauseAfter }, platform: { managedScan, hunt }, effective: { scan, managedScan, aiReview, hunt, aiReviewTurnedOff, huntTurnedOff }, canEdit }` (`canEdit` = the caller is an OWNER).
- On a server without the security plugin (e.g. a self-hosted open-source build) the command prints ``Error: `lumo workspace security-scan` is not available on this Lumo server — the security plugin is not installed there.`` and exits 1 (CLI ≥ 1.106.0); there are no switches to show or change.

### Per-repository automatic review — `--repos` / `--repo` (LUM-1133)

Lumo reviews every PR of each repository the workspace confirmed, including PRs **without a Lumo task**. Per repository (Settings → Workspace → **Automatic review by repository**): `Review` (default on) — whether task-less PRs are reviewed automatically; `Drafts` (default off) — whether drafts are reviewed before they are marked ready. Task-linked PRs are always scanned (Done checks their findings).

```bash
lumo workspace security-scan --repos                                  # list every connected repository
lumo workspace security-scan --repo acme/app                          # one repository
lumo workspace security-scan --repo acme/app --review off             # exit 4 envelope until --confirm
lumo workspace security-scan --repo acme/app --drafts on              # turning on needs no confirmation
lumo workspace security-scan --repos --json                           # { repositories: [{ repo, autoReview, reviewDrafts }], canEdit }
```

```
Repository  Review  Drafts
acme/app    on      off
acme/web    off     off
```

- `--review <on|off>` / `--drafts <on|off>` need `--repo`; neither combines with the switch flags (`--scan`, `--ai-review`, `--hunt`, `--request-changes`, `--allow-author-approval`, `--learnings-scope`, `--auto-pause-after`, `--disable-all`, `--enable-all`).
- A repository the workspace has not connected → `Error: repository … is not connected to this workspace` (exit 1).
- Turning `--review` or `--drafts` **off** is gated by the confirmation protocol (exit 4, nothing sent); OWNER only, refused before any envelope for anyone else. Each change writes a `repository.review_settings_updated` audit event (target `repository`, `{ repo, from, to }`).

#### Auto-review filters and path filters (LUM-1143)

Per repository, for **task-less** PRs (task-linked PRs are always scanned; `@<app> review` / `lumo pr scan --review` always work). Each repeatable flag **replaces** its list; `""` clears it. OWNER only, no confirmation, audited like the switches. The web card has the same fields under **Filters**.

```bash
lumo workspace security-scan --repo acme/app --ignore-title WIP --ignore-title "do not review"
lumo workspace security-scan --repo acme/app --ignore-users 'dependabot[bot]'
lumo workspace security-scan --repo acme/app --labels review-me --labels '!wip'
lumo workspace security-scan --repo acme/app --review off --description-keyword '@lumo review' --confirm
lumo workspace security-scan --repo acme/app --base-branches 'release/.*'     # default branch always included; '.*' = all
lumo workspace security-scan --repo acme/app --path-filter '!docs/**'         # what the AI review / hunt read
lumo workspace security-scan --repo acme/app --labels ""                       # clear a list
```

- `--base-branches <regex>`: full-match regexes on the base branch; the repository's default branch is always reviewed. An **empty list** depends on the repository (`emptyBaseBranchesMeans` in `--json`, shown as `base branches:` under `--repo X`): repositories connected before LUM-1143 keep `all_branches` (every base is reviewed); a repository connected later gets `default_branch_only` (only PRs into the default branch). To review only the default branch on an older repository, list it (`--base-branches main`); to review every base on a newer one, `--base-branches '.*'`.
- `--labels <label>`: `label` = review only PRs carrying one of them; with `--review off` it **opts a PR in**. `!label` = skip PRs carrying it. Negative-only lists never opt in. Case-insensitive.
- `--ignore-title <keyword>`: case-insensitive substring of the title ⇒ skip. `--ignore-users <login>`: exact, case-sensitive author login ⇒ skip (beats everything).
- `--description-keyword <text>`: with `--review off`, a PR whose description contains it (exact substring) is reviewed.
- **Precedence** (first rule that decides wins): ignored users → ignored title / `!label` → enabled/opt-in (positive labels, description keyword) → base branch → drafts.
- `labeled` / `unlabeled` / `edited` (title, description, base) events review a PR that the change **newly** lets through (e.g. adding the opt-in label, dropping `WIP` from the title); a PR that already passed is not re-reviewed.
- `--path-filter <glob>`: globs over changed paths for the AI review and the hunt (`**` any depth, `*` within a segment; a pattern without `/` matches the file name anywhere). `!glob` excludes; a plain glob restricts the review to matches and re-admits a built-in exclusion. Built-in exclusions: lockfiles (`package-lock.json`, `yarn.lock`, `go.sum`, `Cargo.lock`, …), `*.min.js` / `*.map` / `*.snap`, generated code (`*.pb.go`, `*.generated.*`, `__generated__/`), `dist/`, `build/`, `vendor/`, `node_modules/`, `coverage/`. The secret scan and graph rules still read every file.
- `--repo X` (no change) prints the repository's filters under its row; `--json` adds `baseBranches`, `labels`, `ignoreTitleKeywords`, `ignoreUsernames`, `descriptionKeyword`, `pathFilters`, `emptyBaseBranchesMeans`.
- A `.lumo.yaml` at the repository root (`reviews.auto_review.*`, `reviews.path_filters`) overrides these per key, read from the PR's **base** commit — a PR's own copy applies only after it merges; an invalid file falls back to these settings and the PR summary says why. These commands show the stored settings, not the file. Details: `docs/repo-config.md`.

#### Pre-merge checks (LUM-1148)

Per repository, rules every reviewed PR is held to, reported in the PR's security summary (failures in a table, passes folded). Built-ins: **title** (concise, describes the change, plus optional `--title-requirements`) and **description** (filled in; follows the repository's PR template when it has one). Each is `off`, `warning` (default — reported, never blocks) or `error` (a failure keeps Lumo at "Changes requested" while the request-changes workflow is on, and `@uselumo approve` is refused, until the check passes on a later push or title/description edit, or the PR overrides the checks). An **inconclusive** check never blocks (a failed model call never lifts a failure already recorded for the same head). Up to 5 **custom checks** (name ≤ 50 chars, plain-language instructions ≤ 1000) are set in the web card (**Pre-merge checks**) or `.lumo.yaml` (`reviews.pre_merge_checks.custom_checks`), not by flag. The checks run with the AI review (one model call per reviewed head; not on a paused head).

```bash
lumo workspace security-scan --repo acme/app --title-check error --title-requirements 'start with feat:, fix: or chore:'
lumo workspace security-scan --repo acme/app --description-check off --confirm
lumo workspace security-scan --repo acme/app --override-reviewers-only on
```

- Override, per PR: a top-level PR comment `@uselumo ignore pre-merge checks` (write access) — recorded (who, when, head), shown as Ignored in the summary; it covers **every later push** to the PR (the recorded head is for the audit trail, it does not scope the override); it **never** clears a finding that blocks DONE. `--override-reviewers-only on` (`override_requested_reviewers_only` in `.lumo.yaml`): only the PR's reviewers may — requested by name (not via a team), or who already submitted a review — never the author. Off: the author may unless author approval is off.
- Switching a check off, or `--override-reviewers-only off`, exits 4 with an envelope until `--confirm`. `--repo X` lists the checks under the repository; `--json` adds `preMergeChecks`.
- `.lumo.yaml` (`reviews.pre_merge_checks.{title,description,issue_assessment,custom_checks,override_requested_reviewers_only}`) on the base commit overrides these per key; `custom_checks` replaces the whole list. Details: `docs/repo-config.md`.

##### Linked task / issue assessment (LUM-1149)

A built-in check (**Issue assessment**, default `warning`): each requirement of the PR's linked Lumo task (its `## Goal` and each `## Done when` item; a description with neither counts as one) and of each same-repository issue its description closes or links (`closes #12`, `fixes owner/repo#12`, an issue URL; at most 3) is judged **Addressed / Not addressed / Unclear** in the same model call. Any Not addressed ⇒ the check fails (in its mode); otherwise any Unclear ⇒ inconclusive (never blocks); no linked task and no linked issue ⇒ **not applicable** (never failed, no model call for it). The summary lists every requirement; unmet ones are also flagged in one review comment (COMMENT, posted once per distinct unmet set). It only reads the task — never changes its status.

```bash
lumo workspace security-scan --repo acme/app --issue-assessment error
lumo workspace security-scan --repo acme/app --issue-assessment off --confirm
lumo workspace security-scan --repo acme/app --task-details-on-public-repos on --confirm
```

- Privacy: on a **public** repository (or one whose visibility Lumo cannot read) the PR shows only which task item (e.g. `LUM-12 · Done when 2`) and its outcome — never the task's text or Lumo's explanation of it. `--task-details-on-public-repos on` (OWNER; exits 4 until `--confirm`) quotes them there too; it is a Lumo setting only, never read from `.lumo.yaml`. Issue text is always shown (same repository). Private repositories always show the details.
- Turning the check off exits 4 until `--confirm`. `.lumo.yaml`: `reviews.pre_merge_checks.issue_assessment.mode`. The override (`@uselumo ignore pre-merge checks`) covers it like every pre-merge check and never clears a finding that blocks DONE.

#### Review style: path instructions, profile, tone (LUM-1147)

Per repository, for every AI review of its PRs (task-linked too). OWNER only, no confirmation, audited like the filters. The web card has the same fields under **Review style**.

```bash
lumo workspace security-scan --repo acme/app --profile quiet                 # fewer inline comments
lumo workspace security-scan --repo acme/app --tone "Be concise and friendly"
lumo workspace security-scan --repo acme/app --path-instruction 'scripts/**=Flag any console.log' --path-instruction '*.sql=Check every query has a LIMIT'
lumo workspace security-scan --repo acme/app --path-instruction ""          # clear the list
```

- `--profile <quiet|chill|assertive>` changes **posting only** (detection, severities, counts and what blocks Done are identical): `chill` (default) = HIGH + MEDIUM findings get inline comments, LOW is one summary line; `quiet` = only HIGH findings inline, MEDIUM ones are listed in a folded block of the summary; `assertive` = LOW findings inline too. In **every** profile HIGH findings and Done-blocking findings are commented inline. The summary footer names a non-default profile.
- `--tone <text>` (≤250 chars, one line; `""` clears): how the AI review words its titles, details and the PR description, and how Lumo words its answers to questions on the PR (LUM-1154 chat) — wording only, never what is reported. Fixed notes (learning acknowledgements, command replies) do not change.
- `--path-instruction <glob=instructions>` (repeatable, replaces the list, `""` clears; ≤20 entries, glob ≤200 and instructions ≤1000 chars; the glob is everything before the first `=`, same syntax as `--path-filter`, no `!`): extra checks added to the AI review prompt for files matching the glob — only instructions whose glob matches a reviewed file are sent (≤4,000 chars per review, paid out of the review's context budget like learnings). They are fenced, guarded prompt text: they cannot turn a layer off, clear or approve a finding, or change what blocks Done.
- `--repo X` prints `review profile:`, `tone:` and each `path instruction:` under the row; `--json` adds `reviewProfile`, `toneInstructions`, `pathInstructions`.
- `.lumo.yaml` keys `reviews.profile`, `reviews.path_instructions` (`- path: … instructions: …`) and top-level `tone_instructions` override these per key (base commit only, as above).

### `lumo workspace learnings` — PR-review learnings (LUM-1157)

Lists the workspace's PR-review learnings — what reviewers told Lumo in its review threads ("this is intentional because …", LUM-1131) — newest first, ACTIVE only, at most 200. Every reviewed repository of the workspace gets learnings, whether or not it is linked to a Lumo project; a learning of a repository linked to no project belongs to no project's memory (it is scoped to the workspace + repository), so this command is where it is found. Any member may read.

```bash
lumo workspace learnings                     # every repository
lumo workspace learnings --repo acme/app     # one repository (case-insensitive)
lumo workspace learnings --json              # { learnings: [{ id, repo, pathGlob, learning, ruleId, authorLogin, repositoryWide, inProject, createdAt }] }
lumo memory rm <id>                          # delete one (exits 4 with an envelope until --confirm)
```

Each learning prints `<id>  <repo>  [<path glob>]  @<author>  <date>  <scope>[  (no project)]` and then its text, indented. Scope is `repository` once its source PR merged, else `source PR until it merges` (a merge Lumo missed still counts at review time). `--repo` must be `owner/name` (exit 1 otherwise). A project-linked learning can also be edited or deleted in that project's memory.

### When to suggest `workspace security-scan`

- "Turn off / pause code scanning", "stop the AI review on our PRs", "why didn't the hunt run" — and the user is a workspace owner (reading is open to anyone).
- "Don't review PRs in repo X", "review drafts too", "why was my PR without a task (not) reviewed" → `--repos` / `--repo`.
- "Skip WIP PRs", "don't review dependabot", "only review PRs labelled X", "review PRs into release branches", "ignore lockfiles / generated files", "auto-review filters / path filters" → the LUM-1143 filter flags with `--repo`.
- "Too many review comments", "only comment on serious issues", "show nitpicks too", "review in a friendlier / terser tone", "tell the review to check X in folder Y" → `--profile` / `--tone` / `--path-instruction` with `--repo`.
- "Make Lumo request changes / approve PRs", "request changes on open findings" → `--request-changes on` (exits 4 first; relay the envelope).
- "Stop PR authors approving their own PRs via @uselumo", "allow_author_approval" → `--allow-author-approval off` (exits 4 first; relay the envelope); turning it back on is gated too.
- "What has Lumo learned from our review replies", "delete that learning", "undo a learning on a repo without a project" → `lumo workspace learnings [--repo]`, then `lumo memory rm <id>` (exits 4 first; relay the envelope).
- "Use learnings from our other repos", "keep each repo's learnings separate", "share learnings across repositories" → `--learnings-scope global|local|auto` (`global` exits 4 first; relay the envelope).
- "Review every push", "stop pausing reviews after a few pushes", "pause automatic review after N reviewed commits" → `--auto-pause-after <n>` (`0` = never pause).
- **Never** turn a switch off on your own initiative (e.g. to make findings go away): relay the exit-4 envelope and let the user decide. Earlier blocking findings still block Done either way.
