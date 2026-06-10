# lumo verify — machine verification loop（机器验收循环）

`lumo verify` is the machine half of the acceptance system (Acceptance v1,
LUM-343). It executes every **MACHINE** criterion's checkpointer in the local
repo, reports one structured PASS/FAIL verdict per criterion to the server,
and prints what to do next. The judge lives server-side: round numbering, the
3-round cap, escalation, and the IN_REVIEW transition all happen there
(执行在客户端，裁判在服务端).

## The claim-done rule

**Before claiming a task is complete — in conversation, in a wrap-up, or by
touching its status — run `lumo verify`.** The loop replaces "I read the code
and it looks done" with executed evidence.

```
lumo verify              # session-bound task
lumo verify LUM-42       # explicit task (overrides the session binding)
lumo verify --timeout 900  # per-checkpointer timeout in seconds (default 600)
```

## What one round does

1. Loads the task's acceptance contract and picks out MACHINE criteria.
2. Runs each checkpointer locally (shell, cwd = current directory), one at a
   time, echoing PASS/FAIL as it goes.
3. POSTs the structured verdicts; the server records one VerificationRun per
   criterion at round = previous max + 1 and mirrors each verdict as a
   TaskActivity event.
4. Prints the round outcome:
   - **All PASS** → the task transitions to **IN_REVIEW** (existing state
     machine + TASK_IN_REVIEW notification). **Stop here.** Human
     adjudication and any HUMAN criteria take over; never set DONE yourself.
   - **Any FAIL** → task status is untouched; the unmet criteria are printed
     as next actions (statement, checkpointer, failure tail). Fix and re-run.
   - **Round 3 still failing** → the loop escalates: a human is notified
     (AGENT_VERIFY, requires action) and further `lumo verify` rounds are
     rejected with 409. **Stop retrying**; fix only what the human directs.

Exit code 0 = all passed (or nothing to run); 1 = failures, escalation, or
errors.

## Verdict semantics (what the CLI sends)

- checkpointer exits 0 → `PASS` with evidence `cmd:<command>#exit=0`
- non-zero exit → `FAIL`, reason = output tail, enum `CRITERION_UNMET`
- spawn failure / timeout → `FAIL`, enum `CHECK_EXECUTION_ERROR`

evidencePointer is **not free text** — the server only accepts
`commit:<hash>`, `file:<path>:<line>`, or `cmd:<command>#exit=<code>`.
Verdicts are PASS|FAIL only; the agent path cannot write HUMAN verdicts or
`PASS_WITH_FOLLOWUP` (red line — those enter via human-initiated UI paths
only).

## Edge cases

- **No contract yet** → error pointing at `lumo task criteria set`; draft the
  contract first (criteria.md golden rule).
- **HUMAN-only contract (zero MACHINE criteria)** → nothing to run; the CLI
  says so and suggests handing off for human review
  (`lumo task update <id> --status in_review`). No server write happens.
- **A round must cover every MACHINE criterion** — the CLI always runs all of
  them; the server rejects partial rounds.
- Criteria added during review (`REVIEW_ADDED`) appear in the contract and
  are picked up automatically by the next round.

## Round discipline

Rounds are a hard budget of 3, not a retry loop. Between rounds, actually fix
the failures — re-running without changes burns a round and (at round 3)
pages a human. A FAIL round never changes task status; only an all-pass round
moves it (to IN_REVIEW, never further).

## lumo task status — the read half（自查入口）

`lumo task status [task] [--json]` is the read-only counterpart of the loop
(LUM-344): pure read, milliseconds, no LLM, never writes — running it costs
nothing and burns no round. Defaults to the session-bound task; an explicit
identifier overrides.

```
lumo task status            # session-bound task
lumo task status LUM-42     # explicit task
lumo task status --json     # versioned machine-readable payload
```

### When to run it

**Status-first recovery:** run it FIRST — before re-reading code or
planning — whenever you:

- resume a task in a new session (yours or another agent's earlier work);
- come back after a verification round was rejected (`lumo verify` failed);
- were told the task bounced in review (REVIEW_ADDED criteria may have been
  appended at the round they surfaced — they show up here automatically).

It answers "where does the loop stand": what already passed (don't redo it),
what's unmet and why (the exact failure tails), and how many rounds are left.

### What it prints

- Header: task identifier/title/status + `verification round N/3` (round 0 =
  never verified) + an escalation warning when the machine loop is exhausted.
- **Criteria** — every criterion as `<glyph> <id>  [TYPE]  SOURCE@rN
  statement` (✓ latest verdict passed / ✗ failed / ○ no verdict yet) with its
  checkpointer and latest verdict line (evidence pointer on pass, failure
  tail on fail). `REVIEW_ADDED@rN` provenance is visible per row.
- **History** — one line per recorded round: `rN · timestamp · X PASS / Y FAIL`.
- **Last round failures** — the most recent round's FAIL verdicts with their
  rejection reasons (why the last round bounced).
- **Next actions** — the unmet criteria (latest verdict is not a pass:
  failed or never verified, HUMAN ones included). This list IS the plan —
  it is recomputed from the event log on every read, never maintained
  separately. Empty + rounds recorded = awaiting human adjudication.

### --json contract

`--json` emits the full read model with a top-level `version` field
(currently `1`). The schema is versioned: breaking shape changes bump the
major; additive fields don't. Pin on `version` when scripting against it.

`status` reads; `verify` judges. Running status never starts a round, never
escalates, and never changes task state — loop rules (cap 3, IN_REVIEW on
all-pass, human-only DONE) live entirely in `lumo verify` and the server.
