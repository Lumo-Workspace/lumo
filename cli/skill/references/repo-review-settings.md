# Per-repository review settings

`lumo workspace security-scan update --repo <owner/repo> …` — filters, pre-merge checks, review style, PR summary, diagrams. OWNER only for changes; anyone may read with `show --repo`. Workspace switches and the `--repos` list: [workspace-settings.md](workspace-settings.md). **Never** switch a check off on your own initiative — relay the exit-4 envelope and let the user decide.

## Auto-review filters and path filters

Per repository, for **task-less** PRs (task-linked PRs are always scanned; `@<app> review` / `lumo pr review` always work). Each repeatable flag **replaces** its list; `""` clears it. OWNER only, no confirmation, audited like the switches. The web card has the same fields under **Filters**.

```bash
lumo workspace security-scan update --repo acme/app --ignore-title WIP --ignore-title "do not review"
lumo workspace security-scan update --repo acme/app --ignore-users 'dependabot[bot]'
lumo workspace security-scan update --repo acme/app --labels review-me --labels '!wip'
lumo workspace security-scan update --repo acme/app --review off --description-keyword '@lumo review' --confirm
lumo workspace security-scan update --repo acme/app --base-branches 'release/.*'     # default branch always included; '.*' = all
lumo workspace security-scan update --repo acme/app --path-filter '!docs/**'         # what the AI review / hunt read
lumo workspace security-scan update --repo acme/app --labels ""                       # clear a list
```

- `--base-branches <regex>`: full-match regexes on the base branch; the repository's default branch is always reviewed. An **empty list** depends on the repository (`emptyBaseBranchesMeans` in `--json`, shown as `base branches:` under `--repo X`): older repositories keep `all_branches` (every base is reviewed); a repository connected later gets `default_branch_only` (only PRs into the default branch). To review only the default branch on an older repository, list it (`--base-branches main`); to review every base on a newer one, `--base-branches '.*'`.
- `--labels <label>`: `label` = review only PRs carrying one of them; with `--review off` it **opts a PR in**. `!label` = skip PRs carrying it. Negative-only lists never opt in. Case-insensitive.
- `--ignore-title <keyword>`: case-insensitive substring of the title ⇒ skip. `--ignore-users <login>`: exact, case-sensitive author login ⇒ skip (beats everything).
- `--description-keyword <text>`: with `--review off`, a PR whose description contains it (exact substring) is reviewed.
- **Precedence** (first rule that decides wins): ignored users → ignored title / `!label` → enabled/opt-in (positive labels, description keyword) → base branch → drafts.
- `labeled` / `unlabeled` / `edited` (title, description, base) events review a PR that the change **newly** lets through (e.g. adding the opt-in label, dropping `WIP` from the title); a PR that already passed is not re-reviewed.
- `--path-filter <glob>`: globs over changed paths for the AI review and the hunt (`**` any depth, `*` within a segment; a pattern without `/` matches the file name anywhere). `!glob` excludes; a plain glob restricts the review to matches and re-admits a built-in exclusion. Built-in exclusions: lockfiles (`package-lock.json`, `yarn.lock`, `go.sum`, `Cargo.lock`, …), `*.min.js` / `*.map` / `*.snap`, generated code (`*.pb.go`, `*.generated.*`, `__generated__/`), `node_modules/`, `.next/`, `coverage/`, and `dist/` / `build/` / `vendor/` outside a source tree (e.g. `src/main/java/…/build/Foo.java`, `internal/build/`, `pkg/vendor/` are reviewed; `dist/`, `packages/ui/dist/`, Go `vendor/` are not). The PR summary and `lumo pr show` list what the defaults skipped. The secret scan and graph rules still read every file.
- `--repo X` (no change) prints the repository's filters under its row; `--json` adds `baseBranches`, `labels`, `ignoreTitleKeywords`, `ignoreUsernames`, `descriptionKeyword`, `pathFilters`, `emptyBaseBranchesMeans`.
- A `.lumo.yaml` at the repository root (`reviews.auto_review.*`, `reviews.path_filters`) overrides these per key, read from the PR's **base** commit — a PR's own copy applies only after it merges; an invalid file falls back to these settings and the PR summary says why. These commands show the stored settings, not the file. Details: `docs/repo-config.md`.

## Pre-merge checks

Per repository, rules every reviewed PR is held to, reported in the PR's security summary (failures in a table, passes folded). Built-ins: **title** (concise, describes the change, plus optional `--title-requirements`) and **description** (filled in; follows the repository's PR template when it has one). Each is `off`, `warning` (default — reported, never blocks) or `error` (a failure keeps Lumo at "Changes requested" while the request-changes workflow is on, and `@uselumo approve` is refused, until the check passes on a later push or title/description edit, or the PR overrides the checks). An **inconclusive** check never blocks (a failed model call never lifts a failure already recorded for the same head). Up to 5 **custom checks** (name ≤ 50 chars, plain-language instructions ≤ 1000) are set in the web card (**Pre-merge checks**) or `.lumo.yaml` (`reviews.pre_merge_checks.custom_checks`), not by flag. The checks run with the AI review (one model call per reviewed head; not on a paused head).

```bash
lumo workspace security-scan update --repo acme/app --title-check error --title-requirements 'start with feat:, fix: or chore:'
lumo workspace security-scan update --repo acme/app --description-check off --confirm
lumo workspace security-scan update --repo acme/app --override-reviewers-only on
```

- Override, per PR: a top-level PR comment `@uselumo ignore pre-merge checks` (write access) — recorded (who, when, head), shown as Ignored in the summary; it covers **every later push** to the PR (the recorded head is for the audit trail, it does not scope the override); it **never** clears a finding that blocks DONE. `--override-reviewers-only on` (`override_requested_reviewers_only` in `.lumo.yaml`): only the PR's reviewers may — requested by name (not via a team), or who already submitted a review — never the author. Off: the author may unless author approval is off.
- Switching a check off, or `--override-reviewers-only off`, exits 4 with an envelope until `--confirm`. `--repo X` lists the checks under the repository; `--json` adds `preMergeChecks`.
- `.lumo.yaml` (`reviews.pre_merge_checks.{title,description,issue_assessment,custom_checks,override_requested_reviewers_only}`) on the base commit overrides these per key; `custom_checks` replaces the whole list. Details: `docs/repo-config.md`.

### Linked task / issue assessment

A built-in check (**Issue assessment**, default `warning`): each requirement of the PR's linked Lumo task (its `## Goal` and each `## Done when` item; a description with neither counts as one) and of each same-repository issue its description closes or links (`closes #12`, `fixes owner/repo#12`, an issue URL; at most 3) is judged **Addressed / Not addressed / Unclear** in the same model call. Any Not addressed ⇒ the check fails (in its mode); otherwise any Unclear ⇒ inconclusive (never blocks); no linked task and no linked issue ⇒ **not applicable** (never failed, no model call for it). The summary lists every requirement; unmet ones are also flagged in one review comment (COMMENT, posted once per distinct unmet set). The task's recorded decisions (its Decisions tab, with any rationale) override conflicting task requirements as context, without creating extra requirement ids. Other merged PRs linked to the task are supplied as count, repository, numbers and titles (no earlier diffs). Follow-up PRs are judged by their own scope: a requirement covered outside this PR is Unclear rather than Not addressed merely because it is absent from the diff; prior PR titles alone do not prove delivery. Decisions and PR context are never quoted in explanations. It only reads the task — never changes its status.

Besides the diff, two kinds of evidence (LUM-1310) let a requirement the diff alone cannot show be judged instead of coming back Unclear:

- **Test-case runs on the PR head.** The linked task's test cases with their newest run whose commit is the PR's head commit (prefix match; the PR binding is not needed; a dirty-worktree run never counts): the result after the ceiling (a PASS with no evidence, a skipped step or the wrong environment reads UNPROVEN), the per-step results and the evidence file names. Run notes are left out. A requirement that needs runtime evidence (a real-browser screenshot, `tsc` / `jest` exit 0, a parity test) is Addressed only when a PASS run on the head covers it. Runs on older commits and claims in the PR description never count. To make one count, run the case on the head: a `--env local` run records the commit on its own; any other environment needs `--commit <head sha>` ([test-case-runs.md](test-case-runs.md)). One rule is enforced by Lumo itself, after the model: a requirement that asks for a **screenshot** is never Addressed unless a PASS run on the head has an image attached (png/jpeg/webp/gif).
- **One bounded search of the head** for a requirement that says something is absent repo-wide (absence wording plus a backticked literal, plus "grep" / "anywhere" / "across" / "under" or a backticked directory such as `` `app/` ``). Lumo makes one read-only tarball request for the PR's own repository at the head, does a case-sensitive fixed-string search for the literal (the one after "grep" when there is one) in the backticked directories (none ⇒ the whole repository), and gives the model the hit count and the first lines. It runs nothing and builds nothing. Caps: 3 requirements, 4 literals (a requirement whose literals do not all fit is not searched), 128 MiB of archive, files over 1 MiB skipped, 15 s. A search that was cut, in-scope files it skipped (too large, binary) and a directory with no file in it never prove absence — the model is told so.

```bash
lumo workspace security-scan update --repo acme/app --issue-assessment error
lumo workspace security-scan update --repo acme/app --issue-assessment off --confirm
lumo workspace security-scan update --repo acme/app --task-details-on-public-repos on --confirm
```

- Privacy: on a **public** repository (or one whose visibility Lumo cannot read) the PR shows only which task item (e.g. `LUM-12 · Requirement 2 of 3`) and its outcome — never the task's text or Lumo's explanation of it. `--task-details-on-public-repos on` (OWNER; exits 4 until `--confirm`) quotes them there too; it is a Lumo setting only, never read from `.lumo.yaml`. Issue text is always shown (same repository). Private repositories always show the details.
- Turning the check off exits 4 until `--confirm`. `.lumo.yaml`: `reviews.pre_merge_checks.issue_assessment.mode`. The override (`@uselumo ignore pre-merge checks`) covers it like every pre-merge check and never clears a finding that blocks DONE.

## Review style: path instructions, profile, tone

Per repository, for every AI review of its PRs (task-linked too). OWNER only, no confirmation, audited like the filters. The web card has the same fields under **Review style**.

```bash
lumo workspace security-scan update --repo acme/app --profile quiet                 # fewer inline comments
lumo workspace security-scan update --repo acme/app --tone "Be concise and friendly"
lumo workspace security-scan update --repo acme/app --path-instruction 'scripts/**=Flag any console.log' --path-instruction '*.sql=Check every query has a LIMIT'
lumo workspace security-scan update --repo acme/app --path-instruction ""          # clear the list
```

- `--profile <quiet|chill|assertive>` changes **posting only** (detection, severities, counts and what blocks Done are identical): `chill` (default) = HIGH + MEDIUM findings get inline comments, LOW is one summary line; `quiet` = only HIGH findings inline, MEDIUM ones are listed in a folded block of the summary; `assertive` = LOW findings inline too. In **every** profile HIGH findings and Done-blocking findings are commented inline. A finding a path instruction asked for (the AI review names the instruction; Lumo keeps the claim only when that instruction was sent for the finding's file) is commented inline under `chill` and `assertive` whatever its severity, and listed in the summary under `quiet`. The summary footer names a non-default profile.
- `--tone <text>` (≤250 chars, one line; `""` clears): how the AI review words its titles, details and the PR description, and how Lumo words its answers to questions on the PR — wording only, never what is reported. Fixed notes (learning acknowledgements, command replies) do not change.
- `--path-instruction <glob=instructions>` (repeatable, replaces the list, `""` clears; ≤20 entries, glob ≤200 and instructions ≤1000 chars; the glob is everything before the first `=`, same syntax as `--path-filter`, no `!`): extra checks added to the AI review prompt for files matching the glob — only instructions whose glob matches a reviewed file are sent (≤4,000 chars per review, paid out of the review's context budget like learnings). They are fenced, guarded prompt text: they cannot turn a layer off, clear or approve a finding, or change what blocks Done.
- `--repo X` prints `review profile:`, `tone:` and each `path instruction:` under the row; `--json` adds `reviewProfile`, `toneInstructions`, `pathInstructions`.
- `.lumo.yaml` keys `reviews.profile`, `reviews.path_instructions` (`- path: … instructions: …`) and top-level `tone_instructions` override these per key (base commit only, as above).

## High-level PR summary

```bash
lumo workspace security-scan update --repo acme/app --summary comment   # keep it out of the PR description
lumo workspace security-scan update --repo acme/app --summary off
```

- `--summary <description|comment|off>` (OWNER, no confirmation, audited; web card: **Review style → High-level summary**): where the AI review's summary of each PR goes. `description` (default) writes it into the PR **description** inside a Lumo section (`<!-- lumo:summary:start -->` … `<!-- lumo:summary:end -->`): at a line holding only `@uselumo summary` if the author put one there, else appended; every later review rewrites that section only — the author's own text is never changed, and the description is read right before each edit so concurrent edits are kept. The summary comment then points to the description (if the edit fails, the comment shows the summary as before). `comment` = only in Lumo's summary comment, description never edited. `off` = nowhere (an existing section is left as it is).
- The summary always describes the **whole PR** (base…head). An incremental review (only files changed since Lumo's last complete review) gets one extra summary-only model call over the whole PR diff (MEMORY_JUDGE tier, secrets masked, ≤40k characters; over that, the file list plus the previous summary); if that call fails, the previous summary stays and says which commit it describes.
- The setting in force is stored on each scan, so a change applies from the next review (`@uselumo summary` reads the current setting). `.lumo.yaml` key `reviews.high_level_summary` (`description` / `comment` / `off`, or `true` / `false`) overrides it (base commit only).
- `@uselumo summary` on the PR rewrites the section from the latest review's summary (no new AI review), following the repository's current setting. The summary comment's folded **Walkthrough** lists the PR's changed files (status, +/− lines; first 50 named).
- `--repo X` prints `high-level summary:`; `--json` adds `highLevelSummary`.

## Sequence diagram of the call flow

```bash
lumo workspace security-scan update --repo acme/app --sequence-diagrams off
```

- `--sequence-diagrams <on|off>` (OWNER, no confirmation, audited; web card: **Review style → Sequence diagram of the call flow**; default on): when a PR changes a call flow, the folded **Walkthrough** of Lumo's summary comment gets a Mermaid sequence diagram of its main flow (≤8 participants, ≤16 calls). No extra pass: the AI review's own call draws it (an incremental review: the whole-PR summary call, only when the whole diff fits its 40k budget). Trivial PRs never get one — fewer than 2 changed source files or fewer than 20 changed lines in them (tests, docs, migrations, config don't count). The model only names participants and calls; Lumo writes the Mermaid itself and validates it before posting (a diagram that fails is left out).
- `.lumo.yaml` key `reviews.sequence_diagrams` (`true` / `false`) overrides it (base commit only). `@uselumo diagram` on the PR draws it again on request (current setting; refused when off).
- `--repo X` prints `sequence diagrams:`; `--json` adds `sequenceDiagrams`.
