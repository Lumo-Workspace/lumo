# Reading a PR scan (`pr show`, `task show --scans`)

Layout (shared with `task status`): a heading per
block, facts as `Label:  value` rows (a value too long for the line moves
under its label), at most three indent levels, prose wrapped at 100 columns,
every command on its own line; bold headings / dim labels only on a TTY.

```
PR #1013  feat: size the hunt by diff [LUM-787]
  Repo:   Lumo-Workspace/lumo
  State:  MERGED
  Task:   LUM-787
  URL:    https://github.com/Lumo-Workspace/lumo/pull/1013

Scan abcdef0 · FINDINGS
  Started:        2026-09-15T07:00:00Z
  Finished:       2026-09-15T07:04:00Z
  Trigger:        PR_EVENT
  Tokens:         61,000
  Secrets:        checked
  Code scan:      ⚠ didn't finish (1 external finding) — gitleaks exit 2
  Dependencies:   checked (1 dependency finding, 1 already on main)
  AI review:      checked
    AI review budget: diff 117,408 chars · tier 120,000 · 2,592 left (2%)
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
- **Scan heading + rows** — `Scan <short sha> · <status>`: the scan status (`PENDING` / `RUNNING` / `CLEAN` / `FINDINGS` / `FAILED`; a `CLEAN` scan with a layer turned off in the workspace settings prints `no findings in the checks that ran` instead; with scanning turned off for the workspace a `CLEAN` prints `no findings on the commit it scanned (scanning is off now)`, and a `⚠ Security scanning is turned off in this workspace's settings. …` line precedes the scans — an older scan never stands as the PR's answer); rows `Started`, `Finished` (local `YYYY-MM-DD HH:MM`; `not finished`), `Trigger`, and `Tokens` — the hunt's token spend (`not metered` when the row carries null — null is never printed as 0).
- **Layer rows** — one row per layer, the same six-layer grammar and display labels as `lumo task status` and the GitHub PR summary (`Secrets` · `Code scan` · `Dependencies` · `AI review` · `Agent behavior` · `Exploit paths`; `Agent behavior` (stored `rewardHack`) reads the agent sessions behind the PR for tests, metrics or checks gamed instead of the task — a hint only, never blocking; states `checked` / `⚠ didn't finish` / `skipped` / `off` / `scanning` / `⚠ partly checked` / `⚠ superseded` / `off in workspace settings`). `off in workspace settings` (stored `DISABLED`) is a layer the customer turned off in the workspace's security settings (AI review, exploit-path hunt — including a hunt turned off while it was running; or every layer of a managed run that reported after scanning was turned off): never counted as checked, never our fault — a line `Turned off in this workspace's settings: <layers>. That check / Those checks did not look at this PR.` follows the layer rows. `checked` means the layer completed, not that it found nothing. A `Note:  part of this scan hasn't finished on our side — not counted as checked` row appears whenever the scan did not finish and nothing is left queued — whatever the cause, it is worded as ours and never names a reason or asks for anything (the cause itself is internal: `PrSecurityScan.partialCauses`, read by `scripts/security/scan-reliability.ts`); a `Queue:  N left the queue (…)` row explains where a merged/closed PR's undispositioned rows went; an external-scanner reason prints only in its scrubbed form, after `— ` on the `Code scan` row. `AI review has not covered every file yet` under `AI review` marks a truncated review; a size-capped partial review instead reads `over the size limit — reviewed N of M reviewable files` — a limit on the change, not unfinished work.
- **Budget line** — the AI-review layer's own arithmetic, nested under the `AI review` row whenever the layer exists, truncated or not:
  - reviewed whole: `AI review budget: diff 117,408 chars · tier 120,000 · 2,592 left (2%)`
  - truncated: `AI review budget: diff 261,400 chars · tier 180,000 · over by 81,400 · 12 of 41 files dropped, 31.5% of the diff unreviewed`
  - size-capped partial review: `AI review budget: diff 305,874 chars · size limit 180,000 chars, 150 files · over by 125,874 · reviewed 3 of 4 files, 1 left out for size (99.8% of the diff)` — measured against the size limit, not the internal tier; `over by` is omitted when only the file count is over.
  - server config: when the reviewed lines start or configure a server (Makefile / package.json dev-start scripts / Dockerfile CMD / compose ports / an entrypoint that listens), the review also reads up to 4 config files next to it that the PR does not change (≤ 8k chars, masked; never a real `.env`, key or secret file), and the line ends `· server config 1 file (255 chars, read-only): frontend/Trunk.toml`. A risky setting in them is reported on the added line that starts the server, never on the unchanged file. Absent = none were read.
  - no record: `AI review budget: not recorded on this scan` — a scan from before the column existed, or one whose judge never reached the budget step. Never read it as a spend of zero; same fail-closed rule as `tokens not metered`.

  The dropped share is measured in **characters of the diff**, not in files — one dropped lockfile and one dropped route handler are not the same loss. No threshold is flagged (there is no `near cap` marker): the percentage is the signal. The count of changed **source files** is deliberately absent — the tier is not selected by it, and printing it here would imply a relationship that no longer exists.

- **Coverage table** — under the `Exploit paths` row: `done/total planned tasks done`, then one `t<n>  <category>  <seconds>  <stop>` row per planned hunt task (the id column only when the audit has task ids). Absent when the scan stored no usable audit.
- **Findings** — a `Findings:` count row (`N (a open · b block(s) DONE · c dispositioned …)`; `block(s) DONE` is the part of `open` that blocks, and every other row is counted once, under the same label as its `Standing:` line — `already on main`, its queue exit — `merged unreviewed` / `resolved on main` / `PR closed` — `rejected by verifier`, or `other` (a state this CLI does not know), so the buckets besides `block DONE` add up to N; a long row wraps onto the next line), then every row of the scan, dispositioned ones included: `• [SEVERITY] <title>` with `Rule:  <ruleId> (<PROVENANCE>)`, `Where:` and one `Standing:` value (plus `Falsifier:` / `Verifier:  CONFIRMED — "<reason>"` / `AI suggests:  <DISPOSITION> — "<reason>"` rows when present, and for a hunt row a `Call chain:  N edges` row followed by one numbered `from → to` line per edge; `N` counts every edge; the server lists at most 20 and the rest is one `… M more edges not shown` line). A row leading with `[BUG]` is a non-security finding from the AI code review (rule id `review:<kind>`): same scan and disposition flow, never blocking. A row leading with `[AGENT]` is an advisory **Agent behavior** finding (rule id `reward-hack/<KIND>`, kind REWARD_HACK): the agent sessions behind the PR may have gamed a check — title only (`Agent behavior: <kind> in <file>`), the evidence is in the web task record; never blocking, never a security finding, and not listed in the agent reminders:
  - `blocks DONE` / `advisory` — open (undispositioned, not on main, still in the queue); the split follows the workspace policy.
  - `<DISPOSITION> · human` / `· inherited from an earlier scan of this PR` / `· AI-suggested, human-confirmed` — ruled rows, with the human's note when one was left. A disposition is never an AI verdict on its own: an unconfirmed suggestion shows as an `AI suggests:  <DISPOSITION>` row on an open finding.
  - `already on main` — the fingerprint is on the default-branch baseline; not introduced by this PR.
  - `rejected by verifier — "<reason>"` — an AI-review finding the agentic verifier rejected after reading the repository (it only rejects non-HIGH bugs — never one a path instruction asked for — and must cite the refuting `path:line`), or that the ranker run right after it put below its keep threshold — that reason starts with `Ranked low:` and cites no line (it compares the PR's findings with each other; same non-HIGH-bugs-only rule, and never a test finding — a `test_defect` or a finding in a test file). Not open: no inline PR comment, not counted, not in `task status` or the agent reminders. A human can still disposition it.
  - `resolved on main` / `merged unreviewed` / `PR closed` — the row left the queue when the PR merged or closed.
  - `Falsifier:  INCONCLUSIVE` rides along on hunt rows — the falsifier never says PASS.
  - **One issue, one thread:** when the AI review and the exploit-path hunt report the same issue (same or nearby line, matching class), both rows stay here but the PR gets one inline thread (`Same issue also reported by …`). A disposition applies only to the row it is recorded on.
  - **Same issue, new rule id:** a later review that labels the same issue differently gives it a new row; its thread is kept (not resolved as "Addressed"), a thread a human resolved is not raised again unless the issue now blocks DONE or is more severe, and an issue returning on a thread Lumo resolved as "Addressed" is raised again as a regression. Dispositions are not carried over to the new row — it is open until ruled.
- **No scan on record** prints `⚠ No security scan has run for PR #N — could not confirm it is clean.` — the fail-closed wording of `task status`, never an implicit clean.
- A `⚠ N suspected credentials were redacted before injection …` line above the read-out means the server masked registry secrets in free text (finding titles, hunt commands, model step text) before it reached your terminal.

## `--full` — the hunt's per-task detail

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
      cache: read 0 / write 1600 of 1900 input
      stop: submitted · spent 9800/30000 · reserve 4400 · last step 4300 · next 4400 · 3 steps
      wrap-up: not made (submitted)
      candidates: submitted 3 · kept 2 · dropped 1 (reasons: cwe)
    t2 steps · alibaba/qwen3-coder-plus · 6 sites · no shell commands
      stop: steps · spent 19000/30000 · reserve 0 · last step ? · 4 steps
```

Same printer as the lum739 audit report (`shared/src/hunt-audit.ts`), so the
two read the same. Per task: the header (task id, stop reason, model, sites,
shell counts — `no shell commands` for a task that never asked the sandbox
for anything), every command with its output size (`✗` = refused by the gate,
with the gate's reason; `-` = let through), the step trace (`#i tool= in= out= reasoning= elided=
finish= "text"`), the task's prompt-cache totals over those steps (`cache: read N / write M of X
input` — only when the steps recorded cache counters; a reported
`read 0 / write 0` means the stable prefix was under the provider's cache
minimum, not that nothing was measured), the `stop:` arithmetic (spent/budget, reserve held for the
wrap-up, last step's cost, the price the next step was charged at, steps),
the wrap-up outcome, and what `submit_candidates` received (`candidates: submitted N · kept K ·
dropped D (reasons: …)` — `reasons` are the schema field names the
dropped candidates failed on, `limit` past the per-task cap; `· N calls` when
the tool was called more than once; counts are kept when old scan evidence is
scrubbed). Fields a row was written without are simply not
printed — an older scan prints exactly what it recorded.

`stop: no-progress` is the search stopping itself: it spent
`HUNT_NO_PROGRESS_STEPS` steps in a row asking the shell only for commands an
earlier step had already run, so it was reading nothing new, and the forced
wrap-up was made to collect what it held. `repeated N` on the header counts
those re-runs for every task (a converging search repeats a slice once or
twice; the loop this was written for repeated 46 of 73), and `N repeat steps`
on the stop line is the streak the search ended on — printed whatever ended
it, so a near miss is visible on a `budget` or `steps` row too. A diff with more
source files than one run is sized for (`HUNT_OVERSIZED_SOURCE_FILES`, a cost
decision) is hunted in **batches** across runs: riskiest files
first, one run per batch, each batch's findings landing while the layer stays
`scanning`, for diffs of up to **150 source files** (`HUNT_MAX_HUNTED_FILES`,
an industry-standard file cap). The per-run `diff` line then describes that
run's batch.

**Size caps.** The scan says so under the layer rows
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

**Path-filter skips.** Under the layer rows (and in the PR
summary's notices), the files the path filters left out of the AI review:
`Not AI-reviewed by default (lockfiles, generated code, build output and
vendored dependencies): N files — <up to 5 paths> and K more. To have them
reviewed, add include globs for them to path_filters …`, then `Not
AI-reviewed by this repository's path filters: M files.` for the repository's
own exclusions (count only). Absent when nothing was skipped, when the AI
review was paused / off. `dist/`, `build/`
and `vendor/` count as build output only outside a source tree: below a
`src` / `test(s)` / `main` / `internal` / `pkg` / `cmd` / `spec` segment they
are ordinary source and are reviewed.

**PR too large to scan.** A PR that changes more than **300 files**
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
files than the diff — the rest is still on us` is kept
for rows hunted before batching, whose layer reads PARTIAL.

A `no-progress`, `budget` or `steps` stop whose forced wrap-up RAN is a task
that **terminated**: it was asked for its findings and answered, even when the
answer was an empty list, so it no longer makes the layer `⚠ partly checked`
on its own. The coverage payload says both facts — `stopped` is still
how the search ended, `terminated` is whether an answer came back. A timeout, a
sandbox failure, a wrap-up that never ran or that errored, and a skipped task
all stay partial: PARTIAL means "could not confirm this is clean".

The scan records WHY such a task fell short. Our infrastructure (timeout,
sandbox, gateway, a wrap-up that errored or that the provider degraded) →
`HUNT_INCOMPLETE`, and the batch is retried once (each batch has its own
retry). Our budget (the task's turn never came — `skipped` — or its wrap-up
was skipped for `no-budget` / `no-time`) → `HUNT_BUDGET_SHORT`: not retried
(the same budget would hit the same wall), the layer ends PARTIAL at once and
what the finished tasks found is kept. Both read as unfinished on our side,
and neither asks the customer for anything.

`placed by …` breaks the same candidates down on **two axes**, and
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

## `--json` shape

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
                           suggestedDisposition, suggestedReason, suggestionOutcome, secretDowngrade, cwe, reachability,
                           callChain: [ { from, to } ] | null, callChainOmitted, verifierVerdict, verifierReason, externalRef } ],
             hunt: { coverage: { total, done, terminated, categories[] } | null, plannedBy, plannedReason,
                     diff: { sourceFiles, sites, taskCap, oversized } | null,
                     candidates, falsifierRejects, mechanicallyRejected, error,
                     resolution: { kind: 'placement', placed: { subgraph, sinkRule, sandbox }, unplaced, accepted, rejected }
                                 | { kind: 'legacy', subgraph, sinkRule, sandbox, rejected } | null,
                     tasks: [ { taskId, stopped, sites?, model?, shell?, stop?, wrapUp?,
                                submission?: { calls?, submitted?, kept?, dropped?, reasons?: string[] },
                                trace?: [ { i, tool?, text?, inputTokens?, cacheReadTokens?, cacheWriteTokens?,
                                            outputTokens?, reasoningTokens?, elidedChars?, finishReason? } ] } ] } | null } ] }
```

Finding `evidence` (the redacted triggering line) is **not** in the payload
by construction — the server never loads the column for this read.
