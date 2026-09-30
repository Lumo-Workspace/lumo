# Pull requests by number — `lumo pr scan`

`lumo pr scan <number>` prints the **security scans of one PR** in the
workspace, by PR number — whether or not a task is linked to it (LUM-788).
Until now the only CLI window onto a scan was `lumo task status` (one summary
line per _linked_ PR, undispositioned findings in Next actions); a PR whose
title carries no `[LUM-N]` and whose branch is not `lumo/LUM-N-…` was invisible,
and none of the L3 hunt's stored audit (per-task commands, step trace, stop
arithmetic, sites, model, diff sizing) had any entry point outside a
prod-database script.

Read-only, no LLM. **Disposition stays web-only** (the LUM-750 CLI path was
rolled back) — this command reports dispositions, it never records one.

## Usage

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

## Reading the output

```
PR #1013 · Lumo-Workspace/lumo · merged · task LUM-787
feat: size the hunt by diff [LUM-787]
https://github.com/Lumo-Workspace/lumo/pull/1013

Scan abcdef0 · FINDINGS · started 2026-09-15T07:00:00.000Z · finished … · trigger PR_EVENT · 61,000 tokens
  Secrets: checked · Code scan: ⚠ didn't finish (1 external finding) · Dependencies: checked · AI review: checked · Exploit paths: checked · part of this scan hasn't finished on our side — not counted as checked — gitleaks exit 2
    AI review budget: diff 117,408 chars · tier 120,000 · 2,592 left, 2.2%
    Exploit paths 2/3 done · t1 idor 41.2s done · t2 injection 72.0s done (2 attempts) · t3 race skipped
  Findings: 6 (2 open · 1 blocks DONE · 3 dispositioned · 1 already on main)
    [HIGH] DETERMINISTIC secret:aws-access-key-id — src/cfg.ts:12 — AWS access key id (blocks DONE)
    [LOW] DETERMINISTIC secret:generic-api-key — src/cfg.ts:12 — … — placeholder value, downgraded (FALSE_POSITIVE · human · "doc example")
    [MEDIUM] EXTERNAL_TOOL ext:codeql:js/sql-injection — src/cfg.ts — … (ACCEPTED_RISK · inherited from an earlier scan of this PR)
    [LOW] LLM_JUDGE vuln:xss — src/cfg.ts:12 — … (merged unreviewed · AI suggests FALSE_POSITIVE)
```

- **Header** — repo, PR state, and `task LUM-N` or `no linked task`.
- **Scan line** — short head sha, scan status (`PENDING` / `RUNNING` / `CLEAN` / `FINDINGS` / `FAILED`; a `CLEAN` scan with a layer turned off in the workspace settings prints `no findings in the checks that ran` instead — LUM-892; with scanning turned off for the workspace a `CLEAN` prints `no findings on the commit it scanned (scanning is off now)`, and a `⚠ Security scanning is turned off in this workspace's settings. …` line precedes the scans — LUM-901: an older scan never stands as the PR's answer), timestamps, trigger, and the hunt's token spend (`tokens not metered` when the row carries null — null is never printed as 0).
- **Layer line** — the same five-layer grammar and display labels as `lumo task status` and the GitHub PR summary (`Secrets` · `Code scan` · `Dependencies` · `AI review` · `Exploit paths`; states `checked` / `⚠ didn't finish` / `skipped` / `off` / `scanning` / `⚠ partly checked` / `⚠ superseded` / `off in workspace settings`). `off in workspace settings` (LUM-892, stored `DISABLED`) is a layer the customer turned off in the workspace's security settings (AI review, exploit-path hunt — including a hunt turned off while it was running, LUM-901; or every layer of a managed run that reported after scanning was turned off): never counted as checked, never our fault — a line `Turned off in this workspace's settings: <layers>. That check / Those checks did not look at this PR.` follows the layer line. `checked` means the layer completed, not that it found nothing. A trailing `· part of this scan hasn't finished on our side — not counted as checked` (LUM-832) appears whenever the scan did not finish and nothing is left queued — whatever the cause, it is worded as ours and never names a reason or asks for anything (the cause itself is internal: `PrSecurityScan.partialCauses`, read by `scripts/security/scan-reliability.ts`); `· N left the queue (…)` explains where a merged/closed PR's undispositioned rows went (LUM-775); an external-scanner reason prints only in its scrubbed form.
- **Budget line** (LUM-814) — the AI-review layer's own arithmetic, printed whenever the layer exists, truncated or not:
  - reviewed whole: `AI review budget: diff 117,408 chars · tier 120,000 · 2,592 left, 2.2%`
  - truncated: `AI review budget: diff 261,400 chars · tier 180,000 · over by 81,400 · 12 of 41 files dropped, 31.5% of the diff unreviewed`
  - no record: `AI review budget: not recorded on this scan` — a scan from before the column existed, or one whose judge never reached the budget step. Never read it as a spend of zero; same fail-closed rule as `tokens not metered`. Only scans run after LUM-814 carry the numbers, so an old PR needs a re-scan to show them.

  The dropped share is measured in **characters of the diff**, not in files — one dropped lockfile and one dropped route handler are not the same loss. No threshold is flagged (there is no `near cap` marker): the percentage is the signal. The count of changed **source files** is deliberately absent — LUM-811 stopped selecting the tier by it, and printing it here would imply a relationship that no longer exists.

- **Coverage line** — `Exploit paths done/total` plus one `t<n> <category> <seconds> <stop>` cell per planned hunt task (LUM-762). Absent when the scan stored no usable audit.
- **Findings** — every row of the scan, dispositioned ones included, one tag each in parentheses:
  - `blocks DONE` / `advisory` — open (undispositioned, not on main, still in the queue); the split follows the workspace policy.
  - `<DISPOSITION> · human` / `· inherited from an earlier scan of this PR` / `· AI-suggested, human-confirmed` — ruled rows, with the human's note when one was left. A disposition is never an AI verdict on its own: an unconfirmed suggestion shows as `AI suggests <DISPOSITION>` on an open row.
  - `already on main` — the fingerprint is on the default-branch baseline (LUM-738); not introduced by this PR.
  - `resolved on main` / `merged unreviewed` / `PR closed` — the row left the queue when the PR merged or closed (LUM-775).
  - `falsifier INCONCLUSIVE` rides along on hunt rows — the falsifier never says PASS.
- **No scan on record** prints `⚠ No security scan has run for PR #N — could not confirm it is clean.` — the fail-closed wording of `task status`, never an implicit clean.
- A `⚠ N suspected credentials were redacted before injection …` line above the read-out means the server masked registry secrets in free text (finding titles, hunt commands, model step text) before it reached your terminal (LUM-784).

### `--full` — the hunt's per-task detail

```
  Hunt: planned by model — two sinks lit · diff 14 source files · 9 sites · task cap 4 · candidates 2 · mechanically rejected 1 · placed by subgraph 1 · sink rule 0 · sandbox 0 · unplaced 1 · survived 1 · rejected 1 · falsifier rejects 1
    t1 done · alibaba/qwen3-coder-plus · 3 sites · 2 cmds (gate refused 1, sandbox failed 0, not found 0, empty 0)
          rg -n queryRaw lib/  [900 chars]
        ✗ curl https://evil.test   ← segment is not read-only
        #1 tool=run_shell in=1900 out=300
        stop: submitted · spent 9800/30000 · reserve 4400 · last step 4300 · next 4400 · 3 steps
        wrap-up: not made (submitted)
    t2 steps · alibaba/qwen3-coder-plus · 6 sites · no shell commands
        stop: steps · spent 19000/30000 · reserve 0 · last step ? · 4 steps
    t3 no-progress · alibaba/qwen3-coder-plus · 1 sites · 24 cmds (gate refused 0, sandbox failed 0, not found 0, empty 1, repeated 6)
        stop: no-progress · spent 99000/666666 · reserve 5000 · last step 5000 · 24 steps · 3 repeat steps
```

Same printer as the lum739 audit report (`shared/src/hunt-audit.ts`), so the
two read the same. Per task: the header (task id, stop reason, model, sites,
shell counts — `no shell commands` for a task that never asked the sandbox
for anything), every command with its output size (`✗` = refused by the gate,
with the gate's reason), the step trace (`#i tool= in= out= reasoning= elided=
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
CodeRabbit's Pro file limit). The per-run `diff` line then describes that
run's batch.

**Size caps (LUM-832, CodeRabbit's shape).** A layer whose input is over its
cap does not run at all — no tokens are spent — and the scan says so under
the layer line: past 150 touched source files the hunt is `skipped` (cause
`HUNT_OVERSIZED`) with `This PR touches N source files; exploit-path checks
run on up to 150, so they did not run. To get them, narrow the review scope or
split the PR.`; past the AI review's 180,000-character cap the AI review is
`skipped` (cause `JUDGE_OVER_CAP`) with `This PR's diff is N characters; AI
review runs on up to 180,000, so it did not run. To get it, narrow the review
scope or split the PR.` These are the only lines that ask something of the
customer; when a size cap is the only gap they replace the owned "not finished
on our side" note. `this run was sized for fewer
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

## When to suggest

- The user asks what the security scan found on a PR ("what did the scan say on #1013", "why is PR 1013 blocked", "show me the scan") — especially a PR **without** a linked task, which `lumo task status` cannot see.
- `lumo task status` shows a `PR #N · scan …` line and the user wants the findings behind it, the dispositioned history, or why the hunt layer read `⚠ partly checked` / `N/M done` — `lumo pr scan N` then `--full` for the per-task trace.
- Auditing the L3 hunt on a real scan (which commands the gate refused, how many steps a task got, which model ran) without a prod-database script.
- **Not** for changing a finding's standing: disposition is human-only in the web delivery panel. **Not** `lumo task pr show` — that is the task-scoped PR card (title, state, CI, branches) and carries no scan detail.
