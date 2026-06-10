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
