# lumo verify — machine verification loop

`lumo verify` is the machine half of the acceptance system (Acceptance v1,
LUM-343). It executes every **MACHINE** criterion's checkpointer in the local
repo, reports one structured PASS/FAIL verdict per criterion to the server,
and prints what to do next. The judge lives server-side: round numbering, the
3-round cap, escalation, and the IN_REVIEW transition all happen there
(execution on the client, adjudication on the server).

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
- **Session bound to a different task (LUM-459)** → the server returns 409,
  which the command surfaces as an error. No advisory is printed; the verify
  round is rejected outright.
- **Provably-unbound session** → the server includes `bindingAdvisory: 'unbound'`
  in the round response, and the command prints:
  `⚠ Working unbound — this verify ran from a Claude Code session not attached to the task.`
  The run is recorded as a `SESSION_BINDING_MISSING` boundary crossing visible in
  `lumo task status` open crossings. Run `lumo session attach <LUM-N>` before the
  next verify to bind the session.
- **Unconfirmed session binding** → `bindingAdvisory: 'unconfirmed'` causes a
  softer advisory: `⚠ Could not confirm this session is attached to the task.`
  Same remediation: `lumo session attach <LUM-N>`.

## Round discipline

Rounds are a hard budget of 3, not a retry loop. Between rounds, actually fix
the failures — re-running without changes burns a round and (at round 3)
pages a human. A FAIL round never changes task status; only an all-pass round
moves it (to IN_REVIEW, never further).

## Review-time drift habits (gap findings)

A problem discovered during acceptance/review that the contract does NOT
cover is a **gap finding** — record it in the contract, never just fix it
silently:

1. **Append it on the spot.** Transcribe the human's finding as a criterion
   via `lumo task criteria set <task> --file <desired-final-list> --human` —
   the review-added semantics: the gap surfaced at review time, at the
   current round.
2. **Tag why the contract drifted** with `--cause
<NEW_INFO|SCOPE_CHANGE|DRAFT_BLIND_SPOT|GRANULARITY|OTHER>`. Gap findings
   are usually `DRAFT_BLIND_SPOT` (the draft missed it) or `NEW_INFO`
   (information that didn't exist at drafting time).
3. **Then bounce.** The appended criterion shows up in `lumo task status`
   nextActions and the next verify round picks it up automatically — no
   side-channel to-do list.

How to read drift: information-lag and requirement-movement drift
(`NEW_INFO`, `SCOPE_CHANGE`) is healthy — don't optimize it away.
`DRAFT_BLIND_SPOT` clusters feed back into the drafting guide. **Zero drift
across many tasks is a red flag, not a trophy** — it usually means contracts
are too thin or state only sure-win clauses that can never be found wanting.

## lumo task status — the read half (self-check entry point)

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
- **Machine verification rollup** (LUM-470) — directly under the `Criteria`
  header, one line `Machine verification: N machine-verified / M human override
(of T MACHINE criteria)` over the active MACHINE criteria, aligned with the web
  read model (LUM-456). Printed whenever the contract has ≥1 MACHINE criterion,
  so the terminal rollup never reads as all-human when a checkpointer actually
  verified the work.
- **Criteria** — every criterion as `<glyph> <id>  [TYPE]  SOURCE@rN
statement` (✓ latest verdict passed / ✗ failed / ○ no verdict yet) with its
  checkpointer and latest verdict line (evidence pointer on pass, failure
  tail on fail). `REVIEW_ADDED@rN` provenance is visible per row.
  - A passing **MACHINE** criterion's verdict line carries a machine-state tag
    derived from the read model's `machinePassed` flag, NOT the latest verdict
    (LUM-470): `· machine-verified` when a checkpointer actually passed it (even
    after a human later signs the task off), or `· human override (no machine
pass)` when it passes only on a human sign-off with no machine run underneath.
    This keeps the terminal honest with web — a machine-verified criterion that
    a human co-signed no longer reads as a plain human pass.
  - A pass can carry a **`⚠ pre-edit version`** note (LUM-457): the criterion
    was changed after that verdict (reworded, or its checkpointer was swapped so
    the recorded evidence ran a different command). The pass still counts as met
    (a stale pass does not block DONE — render-only signal), but it vouches for
    an older version — **re-run `lumo verify` to re-confirm against the current
    criterion.** This is the habit whenever you edit a MACHINE criterion's
    checkpointer mid-task: change the check, then re-verify so the green is honest.
- **History** — one line per recorded round: `rN · timestamp · X PASS / Y FAIL`.
- **Last round failures** — the most recent round's FAIL verdicts with their
  rejection reasons (why the last round bounced).
- **Next actions** — the unmet criteria (latest verdict is not a pass:
  failed or never verified, HUMAN ones included). This list IS the plan —
  it is recomputed from the event log on every read, never maintained
  separately. Empty + rounds recorded = awaiting human adjudication.
- **Open boundary crossings** (LUM-448) — a trailing safety block when the
  task has ≥1 OPEN (undispositioned) forbidden-action crossing: a count, then
  one line per crossing `• [SEVERITY] CATEGORY — <clipped detail>`
  (highest-severity first), each followed by a read-only **attribution** line
  `↳ by model=<m> · agent=<type>[/branch] · session=<8-char prefix>` (LUM-469 —
  who/what crossed; any dimension that couldn't be resolved server-side prints
  `unknown`, never a fabricated value), then a pointer to the web acceptance
  panel. Silent when there are none, so it never overshadows the criteria.
  **Read-only awareness** — this surfaces crossings detected elsewhere
  (LUM-426/435/442); there is no CLI path to disposition or clear one.
  Disposition stays web + human-only (LUM-426/435/422): an agent/CLI bearer
  cannot clear its own crossing from the terminal. **The check fails closed
  (LUM-480):** if the crossings read itself errors (network / server / parse),
  the block prints `⚠ Boundary-crossing check failed (network/server error) —
could not confirm whether any are undispositioned` instead of staying silent.
  Silence means a successful read with zero open crossings, never a failed
  check — a hiccup can no longer masquerade as "all clear".

### --json contract

`--json` emits the full read model with a top-level `version` field
(currently `1`). The schema is versioned: breaking shape changes bump the
major; additive fields don't. Pin on `version` when scripting against it.
Each criterion carries `machinePassed` (boolean — a checkpointer currently
vouches for it; LUM-456/470), and the payload carries a top-level
`machineVerification` aggregate `{ total, machineVerified, humanOverridden }`
over the active MACHINE criteria — read these, not `latestVerdict` alone, to
tell a machine-verified criterion from a human override.
The open boundary crossings ride along as an additive top-level
`openCrossings` (each entry `{ id, category, severity, detail, attribution }`,
where `attribution` is `{ workspaceMemberId, sessionId, agent, worktreeBranch,
model }` with every field nullable — null = unknown, never fabricated; LUM-469;
the array length is the count) — same read-only awareness, no write path.
**`openCrossings` is `null` when the crossings check failed (LUM-480)** —
distinct from `[]`, which is a successful read with zero open crossings. Script
consumers must treat `null` as "unknown / could not confirm", not "safe".

`status` reads; `verify` judges. Running status never starts a round, never
escalates, and never changes task state — loop rules (cap 3, IN_REVIEW on
all-pass, human-only DONE) live entirely in `lumo verify` and the server.

## lumo verdict — the three verdict channels (LUM-422)

`lumo verify` is the MACHINE channel. `lumo verdict` covers the other two — the
HUMAN pass and the AGENT send-back — under one red line: **no passing data row
is ever agent-produced.**

```
lumo verdict --pass
lumo verdict LUM-42 --pass
lumo verdict --fail --reason CRITERION_UNMET --note "the retry path is still missing"
lumo verdict LUM-42 --fail --reason scope_mismatch --criterion c-abc123
```

### --pass — a deep link, never a write

This resolves the task, then opens the browser to its verdict bar focused on
Pass. **The CLI writes nothing** — PASS only ever lands from a human's own click
(Clerk session). Use this to hand a finished task to a human for the final pass;
it carries them one click from recording it.

### --fail — the AGENT send-back

`--fail --reason <enum>` records a real verdict row server-side with
verifierType=AGENT (a channel distinct from MACHINE and HUMAN, so "machine
all-pass but human FAIL" stays an uncontaminated signal). The verdict is
hard-coded FAIL — there is no agent path to a passing verdict. It:

- requires `--reason` (case-insensitive): `CRITERION_UNMET | EVIDENCE_INSUFFICIENT
| CHECK_EXECUTION_ERROR | SCOPE_MISMATCH | OTHER` — the agent pays the
  structured tax a human send-back is spared;
- takes an optional `--note`, posted as a task comment (@mentions and images for
  free) and summarized onto the verdict row;
- takes repeatable `--criterion <id>` to narrow the send-back; omitted, it fans
  out to the whole contract;
- records at round = the current max (not a new round) and bounces the task back
  to IN_PROGRESS, with the unmet criteria surfacing through `lumo task status`.

### The DONE gate

Once any criterion's latest verdict is FAIL — machine, AGENT, or human — moving
the task to DONE on the agent/CLI path is refused with **409** and the
unresolved items listed. Clear the send-back (fix + re-verify, or a human PASS)
before `lumo task update <id> --status done`. A task with no criteria, or whose
criteria were never adjudicated, transitions freely — the gate only blocks an
actual send-back, never an un-adjudicated criterion. When the machine loop has
left a task IN_REVIEW with no send-back standing, the agent may move it to DONE
directly; a human-PASS row is a provable manual override, not a required ticket.
