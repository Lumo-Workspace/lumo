# Pull requests by number — `lumo pr scan`

`lumo pr scan <number>` prints the **security scans of one PR** in the
workspace, by PR number — whether or not a task is linked to it (LUM-788).
Until now the only CLI window onto a scan was `lumo task status` (one summary
line per _linked_ PR, undispositioned findings in Next actions); a PR whose
title carries no `[LUM-N]` and whose branch is not `lumo/LUM-N-…` was invisible,
and none of the L3 hunt's stored audit (per-task commands, step trace, stop
arithmetic, sites, model, diff sizing) had any entry point outside a
prod-database script.

Without control flags this is read-only, no LLM. This command reports dispositions, it never records
one — the user's ruling goes through [`lumo finding disposition`](#finding-disposition) (or the web panel).

## Usage

### Which PRs are reviewed automatically (LUM-1133)

Every open PR of a repository the workspace confirmed is reviewed on `opened` / `reopened` / `synchronize` / `ready_for_review` — task-linked or not. For a PR **without a task**, the per-repository settings apply (`lumo workspace security-scan --repos`, see [workspace-settings.md](workspace-settings.md)): a repository turned off is not reviewed (unless a PR opts in by label / description keyword), its auto-review filters apply (base branches, labels, title keywords, ignored authors — LUM-1143), and its path filters decide what the AI review reads (lockfiles / generated files left out by default); a draft is skipped until it is marked ready unless the repository includes drafts; a PR converted back to draft keeps its findings and threads, and its pushes are not reviewed while it is a draft. When several workspaces confirmed the same repository, exactly one reviews a task-less PR (the earliest confirmation that would review it; none when another workspace has the PR linked to its task), so GitHub gets one review. Task-linked PRs are always scanned — the scan is the Done gate's evidence. The per-PR reviewed-commit budget and the 150-file cap apply the same way; `lumo pr scan <n> --review full` still reviews any PR by hand.

### Review controls (LUM-1056, LUM-1137)

Every push to an open PR gets an automatic incremental AI review (and exploit-path hunt) — until the PR has N reviewed commits (auto-pause): N is the PR's own `--limit`, else the workspace's `--auto-pause-after` ([workspace-settings.md](workspace-settings.md), default 5, `0` = never pause). Reviewed commits are the commits each reviewed push added; the first automatic review counts one commit, however many the PR already has. A push superseded by a newer one before its review landed counts nothing (the newer push's review covers its commits). An hourly cap per PR author (20 automatic reviews) also applies: a push over it gets its deterministic checks, its AI layers read `rate-limited — automatic review resumes within the hour`, and the next push after the hour is reviewed; a manual review is never limited.

`--review incremental` requests review of affected files since the last complete AI review; `--review full` requests the entire PR. Both bypass the automatic budget without consuming or resetting it. Concurrent requests while a review is active deduplicate; a later request after completion starts another review. Active asynchronous layers must finish before the same head can be restarted.

`--pause` pauses automatic AI review and exploit-path discovery. `--resume` resets the reviewed-commit count (counting from the PR's current commits, so the next N commits are reviewed) and resumes automatic review of every push; it does not immediately review the current head. `--limit 1..100` with pause/resume gives the PR its own pause-after (reviewed commits), over the workspace setting; a later `--resume` without `--limit` keeps it. Failed attempts keep their reservation; retries of an admitted head count nothing again. Deterministic checks continue while AI is paused. Paused does not mean checked and does not clear blocking findings.

Choose exactly one of `--review`, `--pause`, `--resume`. Example: `lumo pr scan 1013 --repo owner/repo --resume --limit 2`. Use these controls when repeated fix pushes keep triggering new AI findings, or when the user requests a manual review/pause/resume.

```bash
lumo pr scan 1013                                 # latest head's scan, prose
lumo pr scan 1013 --full                          # + per-task hunt detail
lumo pr scan 1013 --all                           # every pushed head, newest first
lumo pr scan 1013 --json                          # structured payload (version 1)
lumo pr scan 1013 --repo Lumo-Workspace/lumo      # same number in several repos
```

| Flag                  | Notes                                                                                                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--repo <owner/repo>` | Narrow to one repo. Only needed when the workspace has the same PR number in several repos — the command then exits 1 and lists one `--repo` line per candidate.                             |
| `--all`               | Every head's scan (one row per pushed sha), newest first. Default = the latest head only.                                                                                                    |
| `--full`              | Append the hunt header (plan, diff sizing, gate counts) and the per-task detail: commands (✗ = the gate refused it, with its reason), step trace, `stop:` arithmetic, wrap-up, sites, model. |
| `--json`              | Emit the payload as JSON (`version` field; breaking changes bump it). No prose, no redaction notice line.                                                                                    |

The PR is resolved **inside the caller's workspace** (bearer API key or
browser session). A number that belongs to another workspace is
indistinguishable from one that never existed — `Error: PR #N not found in
workspace <slug>` — so the command never leaks whether a PR exists elsewhere.

### PR comment commands (LUM-1129)

The same controls work from the PR itself: a top-level PR comment whose line starts with the App's handle (production `@uselumo`; derived from `GITHUB_APP_SLUG`) — `@uselumo review` (= `--review incremental`), `@uselumo full review` (= `--review full`), `@uselumo pause`, `@uselumo resume`, `@uselumo resolve`, `@uselumo configuration`, `@uselumo summary`, `@uselumo help`. Lumo answers with a reply; a short unknown command gets the help list (anything longer is a question — see "Questions to Lumo on a PR" below). Only accounts with write access to the repository are obeyed (others, bots and edited comments are ignored silently); it works on PRs with no linked task. `resolve` resolves Lumo's open review threads as the commenter's own resolve — it never dispositions a finding, leaves a finding that blocks DONE open (clear those with `lumo finding disposition` or the web panel), and is open to the PR's author by default (LUM-1142, author approval; `lumo workspace security-scan --allow-author-approval off` refuses the author again). `@uselumo approve` (LUM-1130, only when the workspace's request-changes workflow is on — `lumo workspace security-scan --request-changes on`) resolves Lumo's open threads and approves the PR's current head, dismissing Lumo's earlier "changes requested"; it is refused while any finding blocks DONE (a thread resolved on GitHub does not clear it — only a disposition does), refused for the PR's author only when the workspace turned author approval off (then also when the author is unknown), refused until Lumo's latest scan is of the PR's current head, and does nothing when refused. `@uselumo configuration` (LUM-1153) replies with the effective review settings for the PR — every `.lumo.yaml` key with its value and source (`.lumo.yaml` on the PR's base branch > repository settings > default), the workspace switches (setting vs default) and which layers run; read-only, nothing is changed by comment. `@uselumo summary` (LUM-1151) writes the latest review's high-level summary into the PR description again — Lumo's own section, or the author's `@uselumo summary` placeholder line, never the author's text; it says so when the repository keeps the summary in the comment or has it off (`lumo workspace security-scan --repo <r> --summary`, see `workspace-settings.md`). `@uselumo ignore pre-merge checks` (LUM-1148) overrides the PR's failed pre-merge checks (recorded; a repository may limit it to the PR's reviewers — requested by name, or who already submitted a review — never the author); `approve` is refused while an `error` check fails and the PR has not overridden them. Neither ever clears a finding that blocks DONE. The security summary comment lists the commands under "Lumo commands". `@uselumo ignore` anywhere in the PR **description** (not in a code span, code block or `>` quote; an HTML comment counts) skips the automatic AI review and exploit-path hunt of every push while it stays there (LUM-1152): each push still gets its deterministic checks (secrets, scanners, dependencies — a task-linked PR keeps its DONE-gate scan), its AI layers read `skipped — the PR description asks Lumo to ignore this PR`, and the summary says why. It beats every opt-in (labels, the description keyword); the description is read when the scan runs, so editing it starts nothing by itself — after removing it the next push is reviewed. `@uselumo review` / `lumo pr scan --review` still review on request. A manual review asked for while the head's scan is still running (its scanners, hunt or verifier not finished) waits for that scan to finish and then runs once if that scan's AI review was held (ignored, paused, rate-limited) — checked every 30 s, up to 10 minutes; if the scan's own AI review ran, that is the review (a repeated request deduplicates) — except that a requested full review still runs unless that review was itself a full one (an automatic incremental review does not count).

### Questions to Lumo on a PR (LUM-1154)

Lumo answers questions about a PR's code, grounded in the PR's diff and the asked-about file at the PR head: a reply in one of Lumo's finding threads that asks something (a reply that says the finding is intentional / not applicable still becomes a learning — that path keeps precedence), a review-line comment that mentions `@uselumo` (answered in that thread, with the line as focus), or a PR conversation comment that mentions `@uselumo` and is not a command (a short unknown word after the handle still gets the help list). Only accounts with write access are answered (others, bots and edits are ignored silently); a comment carrying a prompt-injection signal gets no answer; asking Lumo to approve / dismiss / resolve gets a fixed refusal. Answers are words only — they never resolve a thread, disposition a finding or approve; on a finding that blocks DONE the answer says it still blocks. At most 10 answers per PR per hour (one "ask again later" note per window). Model: the AI review's tier, no tools.

### Request-changes workflow (LUM-1130)

Off by default (`lumo workspace security-scan --request-changes on|off`, OWNER). On, Lumo's inline review is posted as **Changes requested**, and Lumo keeps requesting changes (one standing review, not one per sync) while any Lumo thread is open, any finding blocks DONE, or an `error` pre-merge check fails and is not overridden (LUM-1148; an inconclusive check never blocks — [workspace-settings.md](workspace-settings.md#pre-merge-checks-lum-1148)). Lumo **approves** only when the latest head's review is complete (every enabled layer ran whole — not partial, paused, pending or failed), no Lumo thread is open, no finding blocks DONE (resolving its thread on GitHub does not count), every actionable finding is already on the PR, and the PR's head is unchanged when the approval is submitted; it then dismisses its earlier "changes requested" reviews. Off, Lumo posts COMMENT reviews only, and turning the workflow off withdraws Lumo's standing "Changes requested" (LUM-1140): a background pass dismisses Lumo's own change requests on the workspace's open PRs (up to 50 PRs, stops at GitHub's rate limit), and any PR it misses is dismissed at its next review while the workflow is off. Reviews by people are never touched, nothing is approved, and a PR another workspace holds with the workflow on is left alone. `@uselumo approve` is the reviewer's override: it does not wait for every layer to finish, but it still needs Lumo's latest scan to be of the current head and no blocking finding. Whether Lumo's review counts toward branch protection is GitHub's call.

## Reading the output

Layout (LUM-1091, shared with `task status` / `task wrapup`): a heading per
block, facts as `Label:  value` rows (a value too long for the line moves
under its label), at most three indent levels, prose wrapped at 100 columns,
every command on its own line; bold headings / dim labels only on a TTY.

```
PR #1013  feat: size the hunt by diff [LUM-787]
  Repo:   Lumo-Workspace/lumo
  State:  merged
  Task:   LUM-787
  URL:    https://github.com/Lumo-Workspace/lumo/pull/1013

Scan abcdef0 · FINDINGS
  Started:        2026-09-15 15:00
  Finished:       2026-09-15 15:04
  Trigger:        PR_EVENT
  Tokens:         61,000
  Secrets:        checked
  Code scan:      ⚠ didn't finish (1 external finding) — gitleaks exit 2
  Dependencies:   checked (1 dependency finding, 1 already on main)
  AI review:      checked
    AI review budget: diff 117,408 chars · tier 120,000 · 2,592 left, 2.2%
  Exploit paths:  checked
    2/3 planned tasks done
    t1  idor       41.2s  done
    t2  injection  72.0s  done (2 attempts)
    t3  race              skipped
  Note:           part of this scan hasn't finished on our side — not counted as checked
  Queue:          1 left the queue (1 merged unreviewed)
  Findings:
    6 (1 open · 1 blocks DONE · 3 dispositioned · 1 already on main · 1 merged unreviewed)
    • [HIGH] AWS access key id
      Rule:      secret:aws-access-key-id (DETERMINISTIC)
      Where:     src/cfg.ts:12
      Standing:  blocks DONE
    • [LOW] AWS access key id
      Rule:      secret:generic-api-key (DETERMINISTIC)
      Where:     src/cfg.ts:12
      Standing:  FALSE_POSITIVE · human · "doc example" — placeholder value, downgraded
    • [LOW] …
      Rule:         vuln:xss (LLM_JUDGE)
      Where:        src/cfg.ts:12
      Standing:     merged unreviewed
      AI suggests:  FALSE_POSITIVE
    • [BUG] [MEDIUM] Inverted permission check
      Rule:      review:logic_error (LLM_JUDGE)
      Where:     src/auth.ts:40
      Standing:  advisory
```

With review controls on the payload an `AI review` block follows the header:
`Automatic:  enabled · 3/5 commits reviewed` (`12 commits reviewed · never pauses` when the limit is 0; an older server prints `1/2 rounds`), then the `--review incremental`,
`--review full` and `--resume` commands each on its own line, and
`⚠ Latest head has no scan yet; …` when the newest head is unscanned.

- **Header** — `PR #N  <title>`, then `Repo` / `State` / `Task` (`LUM-N` or `no linked task`) / `URL` rows.
- **Scan heading + rows** — `Scan <short sha> · <status>`: the scan status (`PENDING` / `RUNNING` / `CLEAN` / `FINDINGS` / `FAILED`; a `CLEAN` scan with a layer turned off in the workspace settings prints `no findings in the checks that ran` instead — LUM-892; with scanning turned off for the workspace a `CLEAN` prints `no findings on the commit it scanned (scanning is off now)`, and a `⚠ Security scanning is turned off in this workspace's settings. …` line precedes the scans — LUM-901: an older scan never stands as the PR's answer); rows `Started`, `Finished` (local `YYYY-MM-DD HH:MM`; `not finished`), `Trigger`, and `Tokens` — the hunt's token spend (`not metered` when the row carries null — null is never printed as 0).
- **Layer rows** — one row per layer, the same five-layer grammar and display labels as `lumo task status` and the GitHub PR summary (`Secrets` · `Code scan` · `Dependencies` · `AI review` · `Exploit paths`; states `checked` / `⚠ didn't finish` / `skipped` / `off` / `scanning` / `⚠ partly checked` / `⚠ superseded` / `off in workspace settings`). `off in workspace settings` (LUM-892, stored `DISABLED`) is a layer the customer turned off in the workspace's security settings (AI review, exploit-path hunt — including a hunt turned off while it was running, LUM-901; or every layer of a managed run that reported after scanning was turned off): never counted as checked, never our fault — a line `Turned off in this workspace's settings: <layers>. That check / Those checks did not look at this PR.` follows the layer rows. `checked` means the layer completed, not that it found nothing. A `Note:  part of this scan hasn't finished on our side — not counted as checked` row (LUM-832) appears whenever the scan did not finish and nothing is left queued — whatever the cause, it is worded as ours and never names a reason or asks for anything (the cause itself is internal: `PrSecurityScan.partialCauses`, read by `scripts/security/scan-reliability.ts`); a `Queue:  N left the queue (…)` row explains where a merged/closed PR's undispositioned rows went (LUM-775); an external-scanner reason prints only in its scrubbed form, after `— ` on the `Code scan` row. `AI review has not covered every file yet` under `AI review` marks a truncated review; a size-capped partial review (LUM-1144) instead reads `over the size limit — reviewed N of M reviewable files` — a limit on the change, not unfinished work (LUM-1156).
- **Budget line** (LUM-814) — the AI-review layer's own arithmetic, nested under the `AI review` row whenever the layer exists, truncated or not:
  - reviewed whole: `AI review budget: diff 117,408 chars · tier 120,000 · 2,592 left, 2.2%`
  - truncated: `AI review budget: diff 261,400 chars · tier 180,000 · over by 81,400 · 12 of 41 files dropped, 31.5% of the diff unreviewed`
  - size-capped partial review (LUM-1156): `AI review budget: diff 305,874 chars · size limit 180,000 chars, 150 files · over by 125,874 · reviewed 3 of 4 files, 1 left out for size (99.8% of the diff)` — measured against the size limit, not the internal tier; `over by` is omitted when only the file count is over.
  - no record: `AI review budget: not recorded on this scan` — a scan from before the column existed, or one whose judge never reached the budget step. Never read it as a spend of zero; same fail-closed rule as `tokens not metered`. Only scans run after LUM-814 carry the numbers, so an old PR needs a re-scan to show them.

  The dropped share is measured in **characters of the diff**, not in files — one dropped lockfile and one dropped route handler are not the same loss. No threshold is flagged (there is no `near cap` marker): the percentage is the signal. The count of changed **source files** is deliberately absent — LUM-811 stopped selecting the tier by it, and printing it here would imply a relationship that no longer exists.

- **Coverage table** — under the `Exploit paths` row: `done/total planned tasks done`, then one `t<n>  <category>  <seconds>  <stop>` row per planned hunt task (LUM-762; the id column only when the audit has task ids). Absent when the scan stored no usable audit.
- **Findings** — a `Findings:` count row (`N (a open · b block(s) DONE · c dispositioned …)`; `block(s) DONE` is the part of `open` that blocks, and every other row is counted once, under the same label as its `Standing:` line — `already on main`, its queue exit — `merged unreviewed` / `resolved on main` / `PR closed` — `rejected by verifier`, or `other` (a state this CLI does not know), so the buckets besides `block DONE` add up to N, LUM-1116; a long row wraps onto the next line), then every row of the scan, dispositioned ones included: `• [SEVERITY] <title>` with `Rule:  <ruleId> (<PROVENANCE>)`, `Where:` and one `Standing:` value (plus `Falsifier:` / `AI suggests:` rows when present). A row leading with `[BUG]` is a non-security finding from the AI code review (rule id `review:<kind>`, LUM-988): same scan and disposition flow, never blocking:
  - `blocks DONE` / `advisory` — open (undispositioned, not on main, still in the queue); the split follows the workspace policy.
  - `<DISPOSITION> · human` / `· inherited from an earlier scan of this PR` / `· AI-suggested, human-confirmed` — ruled rows, with the human's note when one was left. A disposition is never an AI verdict on its own: an unconfirmed suggestion shows as an `AI suggests:  <DISPOSITION>` row on an open finding.
  - `already on main` — the fingerprint is on the default-branch baseline (LUM-738); not introduced by this PR.
  - `rejected by verifier — "<reason>"` — an AI-review finding the agentic verifier rejected after reading the repository (LUM-988; it only rejects non-HIGH bugs, and must cite the refuting `path:line`), or that the ranker run right after it put below its keep threshold — that reason starts with `Ranked low:` and cites no line (it compares the PR's findings with each other; same non-HIGH-bugs-only rule). Not open: no inline PR comment, not counted, not in `task status` or the agent reminders. A human can still disposition it.
  - `resolved on main` / `merged unreviewed` / `PR closed` — the row left the queue when the PR merged or closed (LUM-775).
  - `Falsifier:  INCONCLUSIVE` rides along on hunt rows — the falsifier never says PASS.
  - One issue, one thread (LUM-1200): when the AI review and the exploit-path hunt report the same vulnerability class on the same line (e.g. `vuln:command_injection` and `hunt:injection`), both rows stay here, but the PR gets one inline thread — the kept row's comment lists the other (`Same issue also reported by …`). The kept row is the one blocking DONE if either does, else the one already on the PR, else the higher severity. A human resolving that thread closes both (non-blocking) rows. A disposition applies only to the row it is recorded on: dispositioning the kept row leaves the other open, and it then gets its own thread.
- **No scan on record** prints `⚠ No security scan has run for PR #N — could not confirm it is clean.` — the fail-closed wording of `task status`, never an implicit clean.
- A `⚠ N suspected credentials were redacted before injection …` line above the read-out means the server masked registry secrets in free text (finding titles, hunt commands, model step text) before it reached your terminal (LUM-784).

### `--full` — the hunt's per-task detail

```
  Hunt audit:
    Planned by:             model — two sinks lit
    Diff:                   14 source files · 9 sites · task cap 4
    Candidates:             2
    Mechanically rejected:  1
    Placed by:              subgraph 1 · sink rule 0 · sandbox 0 · unplaced 1
    Outcome:                survived 1 · rejected 1
    Falsifier rejects:      1
  Hunt tasks:
    t1 done · alibaba/qwen3-coder-plus · 3 sites · 2 cmds (gate refused 1, sandbox failed 0, not found 0, empty 0)
      - rg -n queryRaw lib/  [900 chars]
      ✗ curl https://evil.test   ← segment is not read-only
      #1 tool=run_shell in=1900 out=300
      stop: submitted · spent 9800/30000 · reserve 4400 · last step 4300 · next 4400 · 3 steps
      wrap-up: not made (submitted)
    t2 steps · alibaba/qwen3-coder-plus · 6 sites · no shell commands
      stop: steps · spent 19000/30000 · reserve 0 · last step ? · 4 steps
```

Same printer as the lum739 audit report (`shared/src/hunt-audit.ts`), so the
two read the same. Per task: the header (task id, stop reason, model, sites,
shell counts — `no shell commands` for a task that never asked the sandbox
for anything), every command with its output size (`✗` = refused by the gate,
with the gate's reason; `-` = let through), the step trace (`#i tool= in= out= reasoning= elided=
finish= "text"`), the `stop:` arithmetic (spent/budget, reserve held for the
wrap-up, last step's cost, the price the next step was charged at, steps),
and the wrap-up outcome. Fields a row was written without are simply not
printed — an older scan prints exactly what it recorded.

`stop: no-progress` (LUM-799) is the search stopping itself: it spent
`HUNT_NO_PROGRESS_STEPS` steps in a row asking the shell only for commands an
earlier step had already run, so it was reading nothing new, and the forced
wrap-up was made to collect what it held. `repeated N` on the header counts
those re-runs for every task (a converging search repeats a slice once or
twice; the loop this was written for repeated 46 of 73), and `N repeat steps`
on the stop line is the streak the search ended on — printed whatever ended
it, so a near miss is visible on a `budget` or `steps` row too. A diff with more
source files than one run is sized for (`HUNT_OVERSIZED_SOURCE_FILES`, a cost
decision) is hunted in **batches** across runs (LUM-832): riskiest files
first, one run per batch, each batch's findings landing while the layer stays
`scanning`, for diffs of up to **150 source files** (`HUNT_MAX_HUNTED_FILES`,
an industry-standard file cap). The per-run `diff` line then describes that
run's batch.

**Size caps (LUM-832, LUM-1144).** The scan says so under the layer rows
when a layer's input is over its cap: past 150 touched source files the hunt is
`skipped` (cause `HUNT_OVERSIZED`) with `This PR touches N source files;
exploit-path checks run on up to 150, so they did not run. To get them, narrow
the review scope or split the PR.` The AI review's cap is **150 files and
180,000 characters** of the reviewable diff (path filters apply first, so
lockfiles / generated files never count; `AI review budget: diff N chars` is
that reviewable size). Over it, the AI review reads the files that fit —
security-signal files first, then source, tests, docs; smaller files first
within each — and skips the rest: the AI review row reads `⚠ partly checked`
(cause `JUDGE_PARTIAL_OVER_CAP`) with `This PR is over the AI review's size
limit (150 files, 180,000 characters), so AI review covered R of N reviewable
files. Not reviewed: <up to 10 paths> and K more. To get them reviewed, split
the PR, or narrow it and request a full review (--review full).` Only when
more than a quarter of the reviewable files would be skipped is the AI review
`skipped` whole (cause `JUDGE_OVER_CAP`): `This PR's diff is N characters; AI
review runs on up to 180,000, so it did not run. …` (or `This PR changes N
reviewable files; AI review runs on up to 150, …` when only the file count is
over). A partly reviewed head is never `checked`; a finding is closed (thread
resolved) only on a file the review actually read — a skipped file's thread
stays open. These are the only lines that ask something of the customer; when
a size cap is the only gap they replace the owned "not finished on our side"
note.

**PR too large to scan (LUM-1079).** A PR that changes more than **300 files**
(`GITHUB_DIFF_MAX_FILES` — the most GitHub returns a diff for, checked before
the diff is requested), or whose diff GitHub refuses as too large (406), is not
scanned at all: every layer reads `skipped`, cause `PR_TOO_LARGE`, and the scan
heading's status reads `not scanned — PR too large` instead of `FAILED` / `CLEAN`.
The line under it says why and what to do — `This PR changes N files; security
scans run on PRs of up to 300 files (the most GitHub returns a diff for), so
nothing in it was scanned. To get it scanned, split it into smaller PRs or
narrow its scope.` (or `GitHub would not return this PR's diff because it is too
large (N files changed), …`) — and `Findings: none — nothing in this PR was
scanned`. Never the owned "not finished on our side" note, never counted as
checked. Suggest splitting the PR; re-running the scan on the same head will
not help. A real fault of ours (sandbox timeout, GitHub outage) keeps the
owned note. `this run was sized for fewer
files than the diff — the rest is still on us` (formerly `oversized`) is kept
for rows hunted before batching, whose layer reads PARTIAL.

A `no-progress`, `budget` or `steps` stop whose forced wrap-up RAN is a task
that **terminated**: it was asked for its findings and answered, even when the
answer was an empty list, so it no longer makes the layer `⚠ partly checked`
on its own (LUM-831). The coverage payload says both facts — `stopped` is still
how the search ended, `terminated` is whether an answer came back. A timeout, a
sandbox failure, a wrap-up that never ran or that errored, and a skipped task
all stay partial: PARTIAL means "could not confirm this is clean".

LUM-832 records WHY such a task fell short. Our infrastructure (timeout,
sandbox, gateway, a wrap-up that errored or that the provider degraded) →
`HUNT_INCOMPLETE`, and the batch is retried once (each batch has its own
retry). Our budget (the task's turn never came — `skipped` — or its wrap-up
was skipped for `no-budget` / `no-time`) → `HUNT_BUDGET_SHORT`: not retried
(the same budget would hit the same wall), the layer ends PARTIAL at once and
what the finished tasks found is kept. Both read as unfinished on our side,
and neither asks the customer for anything.

`placed by …` (LUM-798) breaks the same candidates down on **two axes**, and
the distinction matters:

- **placement** — `subgraph` (the id is in the verification graph), `sink rule`
  (the name is one of the system's own sink categories; a library callee can
  never carry a `<file>#<name>` id), `sandbox` (the `file:line` the candidate
  named really carries that identifier, which is how a call site is matched to
  a definition site), and `unplaced`. These four partition `candidates`.
- **outcome** — `survived` (passed every later check and went to the falsifier)
  and `rejected`. These two also partition `candidates`.

A candidate can be **placed and then rejected** — by the entry check, the edge
check or the chain check — so the two axes are not the same measurement.
`rejected / candidates` is the gate's rejection rate; `unplaced / candidates`
is how often placement itself is what failed.

A scan from between the two LUM-798 deploys prints `resolved by … (legacy
tally — placements counted only on acceptance)` instead: its tier numbers
count only candidates that survived, so they are **not** comparable with a
`placed by` row's and are never summed with them. Both are absent on scans
written before the gate counted anything at all.

### `--json` shape

```
{ version: 1,
  pullRequest: { repo, number, title, url, state, task: { identifier } | null },
  all: boolean,
  redactedSecrets: number,
  scans: [ { id, headSha, status, trigger, judgeStatus, truncated,
             stages: { secrets?, external?, supplyChain?, judge?, hunt? },
             partial, externalFailureReason, startedAt, finishedAt, tokenSpent,
             judgeBudget: { diffChars, tierChars, reviewedChars, coveredFiles, droppedFiles } | null,
             counts: { findings, open, blocking, dispositioned, persisting, externalFindings, dependencyFindings },
             queueExits: { RESOLVED_ON_MAIN?, MERGED_UNREVIEWED?, PR_CLOSED? },
             findings: [ { id, kind, ruleId, severity, provenance, filePath, line, title, detail,
                           disposition, dispositionSource, dispositionNote, dispositionedAt,
                           blocking, open, persisting, queueExit, falsifierVerdict,
                           suggestedDisposition, suggestionOutcome, secretDowngrade, cwe, reachability, externalRef } ],
             hunt: { coverage: { total, done, terminated, categories[] } | null, plannedBy, plannedReason,
                     diff: { sourceFiles, sites, taskCap, oversized } | null,
                     candidates, falsifierRejects, mechanicallyRejected, error,
                     resolution: { kind: 'placement', placed: { subgraph, sinkRule, sandbox }, unplaced, accepted, rejected }
                                 | { kind: 'legacy', subgraph, sinkRule, sandbox, rejected } | null,
                     tasks: [ { taskId, stopped, sites?, model?, shell?, trace?, stop?, wrapUp? } ] } | null } ] }
```

Finding `evidence` (the redacted triggering line) is **not** in the payload
by construction — the server never loads the column for this read.

## Errors

- `Error: PR #N not found in workspace <slug>` — unknown number, or a PR of another workspace (same message on purpose).
- `Error: PR #N exists in several repos — pass --repo <owner/repo>` followed by one ready-to-run `lumo pr scan N --repo …` line per candidate.
- `Error: --repo must be owner/repo` — malformed flag, no request made.
- ``Error: `lumo pr scan` is not available on this Lumo server — the security plugin is not installed there.`` — the server has no scan routes at all (e.g. a self-hosted open-source build without the security plugin; CLI ≥ 1.106.0). Nothing to retry; don't suggest scan commands against that server.

## When to suggest

- The user asks what the security scan found on a PR ("what did the scan say on #1013", "why is PR 1013 blocked", "show me the scan") — especially a PR **without** a linked task, which `lumo task status` cannot see.
- `lumo task status` shows a `PR #N · scan …` line and the user wants the findings behind it, the dispositioned history, or why the hunt layer read `⚠ partly checked` / `N/M done` — `lumo pr scan N` then `--full` for the per-task trace.
- Auditing the L3 hunt on a real scan (which commands the gate refused, how many steps a task got, which model ran) without a prod-database script.
- **Not** for changing a finding's standing: that is `lumo finding disposition` (the user's ruling, exit-4 gated) or the web delivery panel. **Not** `lumo task pr show` — that is the task-scoped PR card (title, state, CI, branches) and carries no scan detail.

## Finding disposition

`lumo finding disposition <id...> --false-positive | --accepted-risk [--note "<text>"] [--task <LUM-N>] [--confirm]`
(LUM-1128) records the **user's** ruling on one or more PR security findings. It is how a blocking
finding is cleared for DONE; the web delivery panel stays a second surface (and can correct a CLI
ruling). Resolving the GitHub review thread does **not** clear the gate.

```bash
lumo finding disposition cmabc123 --false-positive --note "test fixture, not a real key"
lumo finding disposition cmabc123 cmdef456 --accepted-risk --note "internal-only endpoint"
```

A gated mutation on the [confirmation protocol](confirmation.md) — no read receipts, no extra steps:

- **Without `--confirm`** it reads the findings from the server and prints ONE `confirmation_required`
  envelope (exit 4, nothing written): one line per finding — id, `[SEVERITY]`, title, rule and location,
  PR, `blocks DONE` / `advisory`, `OPEN → <ruling>`, the note — then the ⚠ DONE consequence. Relay every
  line to the user.
- **Only after the user approves in chat**, run the envelope's `confirmCommand` (your command plus
  `--confirm`). Each finding is reported `✓` / `✗` (exit 1 if any failed), then the status digest.
  **Never add `--confirm` yourself.**
- Ids come from `lumo task status` (`Id:` under each `[SECURITY]` / `[BUG]` item) or `DONE_BLOCKED`
  `blockers[].findingId`. Several ids = one envelope; one ruling per call. An id not on the task fails
  closed (exit 1, nothing written); a finding already carrying the ruling is skipped — its
  `Finding <id> is already <RULING> — skipped.` note is a line in the envelope's `changes` (stdout stays one
  JSON document off a TTY), and is printed as plain text when every id was skipped (exit 0, no envelope).
- `--accepted-risk` means the risk is real and knowingly carried — ask the user for the why and pass it
  as `--note`.
- The server records each ruling with channel `CLI`, the member, the session and the time (task
  timeline + audit log). There is no agent-session guard: the protection is the user's approval of the
  envelope. Reverting a ruling to OPEN is **web-only** (the panel's Reopen, under Change ruling; the CLI
  and any bearer call get 403): the finding blocks DONE again exactly as before it was ruled, the timeline
  shows `WEB <ruling> → OPEN`, and later pushes do not carry the old ruling back. If the user says a CLI
  ruling was a mistake, send them to the web panel.

**When to suggest:** `lumo task status` / `task wrapup` lists a blocking `[SECURITY]` / `[BUG]` finding
the user says is a false positive or an accepted risk; `task update --status done` exits 5 with a
`SECURITY_FINDING` blocker; the user asks to clear, dismiss or accept a scan finding.
