# lumo verify — machine verification loop

`lumo verify` is the machine half of the acceptance system: it executes every **MACHINE** criterion's checkpointer in the local
repo, POSTs one structured PASS/FAIL verdict per criterion, and prints what to
do next. Execution is on the client; adjudication is server-side — round
numbering, the **round cap**, escalation, and the **IN_REVIEW** transition all
happen on the server. The cap is **not a universal constant** — it is the
workspace-level `verificationMaxRounds` (default 3); the effective value for
_this_ workspace is the `M` in the `Round N/M` line that `lumo verify` and
`lumo task status` print.

## The claim-done rule

**Before claiming a task is complete — in conversation, in a wrap-up, or by
touching its status — run `lumo verify`.** The loop replaces "I read the code
and it looks done" with executed evidence.

```bash
lumo verify --note "implemented X in foo.ts because Y; tests + tsc pass"   # session-bound task
lumo verify LUM-42 --note "…"            # explicit task (overrides the session binding)
lumo verify --note "…" --timeout 900     # per-checkpointer timeout in seconds (default 600)
```

**`--note` is optional (LUM-733).** It is your one-line self-report — what
you did and why it is ready ("我改了 X,因为 Y 可验收"). When given and the round
all-passes into IN_REVIEW, it is frozen as the task's claim (source `AGENT`) and
judged for faithfulness in the background; when omitted the round still posts
and the claim degrades to the synthesized run summary. It is never a
precondition for verifying — don't hold a round back to word it.

## What one round does

1. Loads the task's acceptance contract and picks out MACHINE criteria.
2. Runs each checkpointer locally (shell, cwd = current directory, env = the
   CLI's own minus its private `LUMO_NO_HINTS` mute — `--no-hints` never
   reaches a checkpointer), one at a time, echoing PASS/FAIL as it goes.
3. POSTs the structured verdicts; the server records one VerificationRun per
   criterion at round = previous max + 1 and mirrors each verdict as a
   TaskActivity event.
4. Prints the round outcome:

| Round outcome                                      | Effect                                                                                                                                                            | What to do                                                                                    |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **All PASS**                                       | Task transitions to **IN_REVIEW** (existing state machine + TASK_IN_REVIEW notification); the `--note` self-report is frozen as the task's claim (source `AGENT`) | **Stop here.** Human adjudication + any HUMAN criteria take over; **never set DONE yourself** |
| **Any FAIL**                                       | Task status untouched; unmet criteria printed as next actions (statement, checkpointer, failure tail)                                                             | Fix and re-run                                                                                |
| **Last round still failing** (round = the cap `M`) | Loop escalates: a human is notified (AGENT_VERIFY, requires action); further `lumo verify` rounds are rejected with **409**                                       | **Stop retrying**; fix only what the human directs                                            |

Exit code 0 = all passed (or nothing to run); 1 = failures, escalation, or
errors.

## Verdict semantics (what the CLI sends)

| Checkpointer result     | Verdict | Detail                                       |
| ----------------------- | ------- | -------------------------------------------- |
| exits 0                 | `PASS`  | evidence `cmd:<command>#exit=0`              |
| non-zero exit           | `FAIL`  | reason = output tail, enum `CRITERION_UNMET` |
| spawn failure / timeout | `FAIL`  | enum `CHECK_EXECUTION_ERROR`                 |

- evidencePointer is **not free text** — the server accepts only `commit:<hash>`, `file:<path>:<line>`, or `cmd:<command>#exit=<code>`.
- Verdicts are PASS|FAIL only; **the agent path cannot write HUMAN verdicts or `PASS_WITH_FOLLOWUP`** (red line — those enter via human-initiated UI paths only).

## Edge cases

| Case                                            | Behavior                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No contract yet**                             | Error pointing at `lumo task criteria set`; draft the contract first (criteria.md golden rule).                                                                                                                                                                                                                      |
| **HUMAN-only contract** (zero MACHINE criteria) | Nothing to run; CLI says so and suggests `lumo task update <id> --status in_review` for human review. No server write happens.                                                                                                                                                                                       |
| **Partial round**                               | A round must cover every MACHINE criterion; the CLI always runs all of them and the server rejects partial rounds.                                                                                                                                                                                                   |
| **`REVIEW_ADDED` criteria**                     | Criteria added during review appear in the contract and are picked up automatically by the next round.                                                                                                                                                                                                               |
| **Session bound to a different task**           | Server returns 409, surfaced as an error. No advisory printed; the verify round is rejected outright.                                                                                                                                                                                                                |
| **Provably-unbound session**                    | Response carries `bindingAdvisory: 'unbound'`; prints `⚠ Working unbound — this verify ran from a Claude Code session not attached to the task.` Recorded as a `SESSION_BINDING_MISSING` boundary crossing (visible in `lumo task status` open crossings). Run `lumo session attach <LUM-N>` before the next verify. |
| **Unconfirmed session binding**                 | `bindingAdvisory: 'unconfirmed'` → softer advisory `⚠ Could not confirm this session is attached to the task.` Same remediation: `lumo session attach <LUM-N>`.                                                                                                                                                      |

## Round discipline

Rounds are a hard budget, not a retry loop — and the size of that budget is a
workspace setting (`verificationMaxRounds`, default 3), so check `Round N/M`
instead of assuming three. Between rounds, actually fix the failures —
re-running without changes burns a round and (on the last one) pages a human. **A FAIL round never changes task status; only an all-pass round moves it
(to IN_REVIEW, never further).**

## Review-time drift habits (gap findings)

A problem discovered during acceptance/review that the contract does NOT cover is
a **gap finding** — record it in the contract, never just fix it silently:

1. `lumo task criteria set <task> --file <desired-final-list> --human` — append it on the spot, transcribing the human's finding as a criterion. Review-added semantics: the gap surfaced at review time, at the current round.
2. `--cause <NEW_INFO|SCOPE_CHANGE|DRAFT_BLIND_SPOT|GRANULARITY|OTHER>` — tag why the contract drifted. Gap findings are usually `DRAFT_BLIND_SPOT` (the draft missed it) or `NEW_INFO` (info that didn't exist at drafting time).
3. `lumo task status` — then bounce: the appended criterion shows up in nextActions and the next verify round picks it up automatically. No side-channel to-do list.

How to read drift: information-lag and requirement-movement drift (`NEW_INFO`,
`SCOPE_CHANGE`) is healthy — don't optimize it away. `DRAFT_BLIND_SPOT` clusters
feed back into the drafting guide. **Zero drift across many tasks is a red flag,
not a trophy** — it usually means contracts are too thin or state only sure-win
clauses that can never be found wanting.

## lumo task status — the read half (self-check entry point)

`lumo task status [task] [--json]` is the read-only counterpart of the loop: pure read, milliseconds, no LLM, never writes — running it costs
nothing and burns no round. Defaults to the session-bound task; an explicit
identifier overrides.

```bash
lumo task status            # session-bound task (core: criteria / next actions / open crossings)
lumo task status LUM-42     # explicit task
lumo task status --full     # + verification rollup, history, cost, struggle trail, trend
lumo task status --json     # versioned machine-readable payload
```

### When to run it

**Status-first recovery:** run it FIRST — before re-reading code or planning —
whenever you:

- resume a task in a new session (yours or another agent's earlier work);
- come back after a verification round was rejected (`lumo verify` failed);
- were told the task bounced in review (REVIEW_ADDED criteria may have been appended at the round they surfaced — they show up here automatically).

It answers "where does the loop stand": what already passed (don't redo it),
what's unmet and why (the exact failure tails), and how many rounds are left.

### What it prints

- **Header** — task identifier/title/status + `verification round N/M` (`M` = the workspace's `verificationMaxRounds`; round 0 = never verified) + an escalation warning when the machine loop is exhausted.
- **Default = the self-check core (LUM-733):** header, Criteria, Last round failures, Next actions, Open boundary crossings. The dashboard sections below (**Verification**, **History**, **Cost**, **Struggle**, **Trend**) print only with `--full` — they are human-dashboard material and cost context. The claim text and faithfulness verdict are no longer rendered in the terminal (`--json` still carries `claim` / `faithfulness` for scripts).
- **Verification** (`--full`) — the measured rollup `N machine-verified / M human override (of T MACHINE criteria)` plus `X of Y criteria met`; before any round it prints `no verification has run yet`. (Relocation six, whole-branch review third pass: this used to say `X of Y criteria met by their latest verdict` — the `X` count is `isUnmetForDisplay`-based same as everywhere else post-LUM-789, so it counts a tacit-pass HUMAN criterion as met even though that row carries no verdict at all; dropped the verdict claim rather than invent a third vocabulary for "met" alongside the Criteria section's glyphs and the closing line's judged/tacit split.)
- **Criteria** — every criterion as `<glyph> <id>  [TYPE]  SOURCE@rN statement` (✓ latest verdict passed / ✗ failed / ○ no verdict yet / `~` a **HUMAN** criterion with no verdict — a **tacit pass**, settled but never individually judged, distinct from both ✓ and the still-open ○) with its checkpointer and latest verdict line (failure tail on fail; a `~` row's line reads `(tacit pass — no objection raised, not individually judged)` instead of `(no verdict yet)`). `REVIEW_ADDED@rN` provenance is visible per row.
  - A passing **MACHINE** criterion's verdict line carries a machine-state tag derived from the read model's `machinePassed` flag, NOT the latest verdict: `· machine-verified` when a checkpointer actually passed it (even after a human later signs the task off), or `· human override (no machine pass)` when it passes only on a human sign-off with no machine run underneath. This keeps the terminal honest with web — a machine-verified criterion that a human co-signed no longer reads as a plain human pass.
  - A verdict's **evidence is drillable**, rendered as an indented `↳ evidence:` line under the verdict (PASS _and_ FAIL) instead of the inert raw pointer that used to ride the verdict line — so a conclusion points at real proof you can act on, not just the `check:` command: a `cmd:` pointer prints the actual command + exit code (`ran \`…\` → exit N · re-run to reproduce`), a `file:`pointer prints a terminal-clickable`path:line`, and a `commit:` pointer prints a navigable web URL (`<repo>/commit/<hash>`, resolved from the local git `origin`remote) or a`git show <hash>`fallback when no remote resolves. A criterion that **requires evidence but has none recorded yet** (e.g. a HUMAN evidence criterion before sign-off) renders an explicit`↳ evidence: pending — no reference recorded yet`(fail-closed) instead of a bare, dead`[evidence]` tag.
  - A pass can carry a **`⚠ pre-edit version`** note: the criterion was changed after that verdict (reworded, or its checkpointer was swapped so the recorded evidence ran a different command). The pass still counts as met (a stale pass does not block DONE — render-only signal), but it vouches for an older version — **re-run `lumo verify` to re-confirm against the current criterion.** This is the habit whenever you edit a MACHINE criterion's checkpointer mid-task: change the check, then re-verify so the green is honest.
- **History** (`--full`) — one line per recorded round: `rN · timestamp · X PASS / Y FAIL`.
- **Last round failures** — the most recent round's FAIL verdicts with their rejection reasons (why the last round bounced).
- **Cost** (`--full`) — 规律 1: the costs a human should weigh, on the same report as the verdict instead of scattered across the web delivery card and `task lineage`. Three lines: **Tokens** (total input+output+cache across the task's sessions), **Active time** (non-idle agent seconds — Σ per-turn `STOP − prompt`), and **Rework rounds** (verify rounds that recorded a FAIL). Read from the **same** server-side source the web delivery card consumes (`retrospectiveRepository.loadActuals`), so the two reports cannot drift. Token cost is **fail-closed**: when no session usage was recorded it prints `Tokens: not recorded (no session usage captured)`, kept distinct from a measured `0` (没测到 vs 花了0). Carried in `--json` as `cost { tokenCost, activeTimeSec, reworkRounds }` (`tokenCost: null` = not measured). Omitted only against an older server that doesn't emit the field.
- **Struggle / rework / outstanding** (`--full`) — the anti-mum-and-deaf block: **always printed when the contract exists, even on a clean 0-unmet task** so a passing task still shows its scars instead of wiping them to a single PASS count. Lists, when present:
  - **rework rounds** — verify rounds that had a FAIL;
  - **send-backs** — criteria sent back by a human/agent verdict (a MACHINE verify-loop FAIL is not a 打回), with their open/resolved lifecycle, preserved even for since-removed criteria;
  - **leftover follow-ups** — criteria whose latest verdict is `PASS_WITH_FOLLOWUP`;
  - **PR iterations** — when the task has >1 PR (the dominant rework signal when the verify loop ran once but the work churned across many follow-up PRs); a single PR is the happy path and is not flagged;
  - **reopens** — backward `IN_REVIEW/DONE → IN_PROGRESS/TODO` transitions (from the `STATUS_CHANGED` log): the task reached review/done and got bounced, a rework that leaves no FAIL verdict.

  When the trail is genuinely empty it states the **basis** (`None recorded — N rounds run, 0 FAIL, no send-backs, no reopens, no leftover follow-ups`); when nothing has been verified yet it says so (`No verification has run yet — cannot confirm there were no difficulties`) rather than rendering an implicitly-clean slate. Carried in `--json` as `struggleTrail` (incl. `pullRequests` + `reopens`).

- **Trend** (`--full`) — 规律 7 趋势非快照: the _movement_ of the key quantities across the task's attempts, not a single snapshot. Where History/Cost/Struggle list current values, this shows direction: **Pass rate** across verification rounds (`r1 60% → r2 100% (↑ +40pts)`), **Cost/session** across the task's sessions (`4.2K → 1.1K tokens (↓), 5.3K total` — per-session spend from the same source as the **Cost** total, so the trajectory's points sum to it), and **Rework** accrual (`3 accrued — 1 FAIL round, 1 reopen, +1 PR cycle (↑ from 0)`). **Honest about a single point:** with only one round and one session every quantity is one data point, so it prints `Single attempt so far — no trajectory yet (a trend needs ≥2 rounds or sessions)` rather than drawing a fake arrow off one value. When nothing was verified and no cost was measured it says `No verification rounds or measured cost yet — nothing to trend`. Carried in `--json` as `trend { passRate[], cost[], rework{} }`. Omitted only against an older server.

- **Next actions** — the unmet criteria followed by any **undispositioned PR security findings** (LUM-737) as `• [SECURITY] [SEVERITY] PROVENANCE ruleId — file:line — title (PR #n · blocks DONE | advisory[ — <cause>, downgraded])`. **"Unmet" (LUM-789):** a **MACHINE** criterion is unmet whenever its latest verdict is not a pass — failed or never verified. A **HUMAN** criterion with no verdict yet is **not** unmet — it's a **tacit pass**: no one ever has to hand it off for a human to explicitly PASS it, and it never blocked DONE (the server's DONE gate, `assertNoUnresolvedSendBack`, already only ever refused on an explicit FAIL — never on a merely-unadjudicated criterion, tacit pass is not a new leniency). Only an explicit send-back (a human FAIL) makes a HUMAN criterion unmet, and it stays unmet until re-verified. This is the render rule for what shows up here (`lib/acceptance/unmet-display.ts`) — a separate mechanism (a human submitting a web verdict, which recomputes the task's own status) still requires every selected criterion to carry an explicit PASS before that action moves the task to DONE; the two are not the same gate and must not be conflated. The trailing **downgrade cause** appears only on deterministic `secret:*` rows the scanner lowered to LOW — `placeholder value` (the matched string looks like `…EXAMPLE`, `YOUR_…`, `CHANGEME`…) or `test/fixture/doc path`. Downgrading is **not** suppression: the row is still reported so a human decides, and the cause is what lets you tell a recognised test fixture from a real leak without opening the file. Absent on rows scanned before the cause was recorded, and on any row that was not downgraded — silence means "not downgraded", never "cause unknown". This list IS the plan — recomputed from the event log + the latest scan per linked PR on every read, never maintained separately. The header counts them separately: `Next actions (N unmet · M security findings)`. A finding is **not** a criterion: fix it and push (a fixed fingerprint disappears from the next scan) or a human dispositions it in the web delivery panel — there is no CLI path to clear one, and a `blocks DONE` finding refuses DONE with 409. **Empty + rounds recorded (Finding 2, second whole-branch review):** the closing line is honest about _whether anyone actually judged_ the HUMAN criteria, not a blanket "awaiting human adjudication" — that claim is false the moment even one HUMAN criterion settled as a tacit pass (nothing is being "awaited"), and it's _also_ false once every criterion already carries an explicit verdict (the adjudication already happened, nothing is pending). Four cases: no HUMAN criteria in the contract at all → `All criteria met by their latest verdicts.`; every HUMAN criterion carries an explicit verdict → `All criteria met by their latest verdicts — human-judged.`; none of them do (a fresh, never-adjudicated contract) → `All criteria met — no objection raised on the HUMAN criteria; not individually judged.`; some do and some don't → `All criteria met — N/M HUMAN criteria explicitly judged, the rest accepted as drafted.` Mirrors the web hero banner's own judged/tacit/mixed split (`VerdictDecision.tsx`'s `allPassed` vs the tacit-aware `machineAwaitingHuman` kind) — same rule, two surfaces.
  - **Per-PR scan status** (LUM-735): before the unconfirmed-PR lines, one line per linked PR that has a latest scan (open or closed alike): `PR #945 · scan CLEAN · Secrets: checked · Code scan: checked (2 external findings) · Dependencies: checked (1 dependency finding, 1 already on main) · AI review: checked · Exploit paths: ⚠ incomplete` — stage segments only for keys present, in secrets/external/supplyChain/judge/hunt order. **The stage keys are internal; what prints is their display label** (LUM-763, `shared/src/security-scan.ts`, shared with the GitHub PR summary so the two cannot drift): `secrets`→Secrets, `external`→Code scan, `supplyChain`→Dependencies, `judge`→AI review, `hunt`→Exploit paths; states render as `RAN`→checked, `SKIPPED`→skipped, `NOT_CONFIGURED`→off, `PENDING`→scanning, `PARTIAL`→⚠ incomplete, `SUPERSEDED`→⚠ superseded, `FAILED`→✗ failed. "checked" means the layer completed, **not** that it found nothing — findings are counted in their own segments and in the next-actions list (`hunt` = the L3 vulnerability hunt, LUM-739: absent when `LUMO_SECURITY_HUNT=off`, `SKIPPED` when no trigger fired, `PENDING` while the workflow runs, `RAN` / `PARTIAL` (budget hit, a planned task that never finished, or more surviving candidates than the falsifier cap) / `FAILED`; its findings are `LLM_JUDGE` advisory, never `blocks DONE`); `(N external findings)` (singular at 1) decorates only the Code scan segment, and only when N > 0; `(N dependency findings[, M already on main])` (LUM-738; singular at 1) decorates only the Dependencies segment, only when N > 0, and prints bare `Dependencies: <state>` against an older server without the counts; ` · partial` appended when the scan is partial; and, when `stages.external === 'FAILED'` and a **scrubbed scanner reason** was recorded (the `error` column carries the `external: ` provenance prefix), an appended ` — <reason without the prefix, tail 200 chars>` — an unprefixed `error` (stage A's own raw crash text) is never printed here, same P8 rule as the web panel and the PR summary (LUM-756). Fed by the additive `securityFindings.scans` array; omitted entirely (no lines) against an older server that doesn't send it.
  - **Hunt coverage line** (LUM-762): indented under its scan line whenever the server sends the L3 hunt's per-category audit — `Exploit paths 2/3 done · t1 idor 41.2s done · t2 injection 72.0s done (2 attempts) · t3 race skipped`. `<n>/N done` is how many planned tasks finished (where N is the number of tasks the planning step selected for this scan, typically 0–3). Rows persisted before LUM-758 lack a planned-task count and fall back to the historical 6-category denominator (reading as `/6` instead). Each segment is `[taskId ]<category> <elapsed>s <stop>` — the `taskId` prefix (`t1`, `t2`, …) appears only on current rows where the task graph is present (post-LUM-758), and is omitted on pre-task-graph audit rows, so they render exactly as they always did. Elapsed is summed over the task's attempts; `(N attempts)` when the workflow retried it; no elapsed for a `skipped` task (the scan's budget ran out before its turn). Stop values: `done` · `steps` · `budget` · `timeout` · `error` · `skipped`. Headed by the same display label as the layer's own segment (LUM-763), so the detail line and the line above it never name the layer two different ways. This is the only surface that reads `huntAudit`, so it is where you answer "how long does a healthy task take" and "which tasks never ran" without paging through deploy logs. Absent on an older server and on scans with no usable audit (pre-LUM-739 rows, or a hunt that failed before its first batch) — no line, never a guess.
  - **Queue exit** (LUM-775): a merged / closed PR's line ends with ` · N left the queue (a resolved on main, b merged unreviewed, c PR closed)` when any undispositioned row has left the queue — derived at read time, never stored. `resolved on main` = an external-tool finding whose fingerprint is absent from a default-branch baseline that can testify (landed, whole, requested after the merge, ran that tool); `merged unreviewed` = an advisory row whose PR merged without a decision (a policy-blocking row never exits this way — it stays a next action and keeps blocking DONE until a human decides, or until a fresh baseline shows it gone); `PR closed` = closed without merging, nothing landed (reopening the PR puts the rows back). Exited rows are not next actions, are not counted in `openFindings`, and show muted with the reason in the web panel. Absent on an older server. The workspace-wide read-out with per-row reasons is `scripts/analysis/lum775-finding-queue/report.ts`.
  - **Persisting findings** (LUM-738): a finding whose fingerprint is already on the repository's default-branch baseline (`persisting`) is not this PR's — it never appears as a next action, is not counted in `openFindings`, and shows muted (_already on the default branch_) in the web panel. Dependency findings (`kind=DEPENDENCY`, from osv-scanner) are advisory: they never block DONE.
  - **Fails closed:** `⚠ Security-scan check failed — could not confirm …` when the scan read errored, and one `⚠ PR #n: … — could not confirm it is clean.` line per open PR whose latest scan is missing / FAILED / still running. Silence means a successful read with nothing open, never a failed check.
- **Open boundary crossings** — a trailing safety block when the task has ≥1 OPEN (undispositioned) forbidden-action crossing: a count split the way the server DONE gate counts it — `(N undispositioned: B blocking DONE, A advisory / non-blocking)` (LUM-771) — then one line per crossing, blocking rows first as `• [SEVERITY] CATEGORY — <clipped detail>` (highest-severity first) and non-blocking rows as `◦ [SEVERITY] CATEGORY (advisory — does not block DONE)` / `(below the workspace gate — does not block DONE)` — an advisory row a SYSTEM re-judge produced appends ` · re-judged: <evidence>` (LUM-780: its cause no longer holds — the rule text is still in CLAUDE.md, or no linked PR removes a tracked test file; the row stays OPEN for a human ruling, it just no longer blocks); only the `•` rows need a ruling before DONE, each followed by a read-only **attribution** line `↳ by model=<m> · agent=<type>[/branch] · session=<8-char prefix>` (who/what crossed; any dimension that couldn't be resolved server-side prints `unknown`, never a fabricated value), then a pointer to `lumo crossing disposition` and the web acceptance panel. Silent when there are none, so it never overshadows the criteria.
  - **Read-only awareness** — this block surfaces crossings detected elsewhere and clears nothing itself. The ruling is the user's: `lumo crossing disposition <id> --false-positive | --confirmed` (exit-4 envelope you relay, LUM-769 — see below) or the web panel. You never self-approve.
  - **The check fails closed:** if the crossings read itself errors (network / server / parse), the block prints `⚠ Boundary-crossing check failed (network/server error) — could not confirm whether any are undispositioned` instead of staying silent. Silence means a successful read with zero open crossings, never a failed check — a hiccup can no longer masquerade as "all clear".

### Responding to an open crossing — `lumo crossing explain`

When `lumo task status` surfaces an OPEN crossing you believe is a false positive
— or you simply want to leave a rationale for the human reviewer — append a
self-explanation ("申辩") to it:

```bash
lumo crossing explain <id> --note "this was a generated fixture, not a hand-edited migration"
```

This is the **inverse** of dispositioning, but it is the agent/CLI path
(bearer-only; a clerk/human caller is refused). Behavior:

- it can **only append** an append-only note — it **never clears the crossing or unblocks Done** (the user rules, via `lumo crossing disposition` or the web panel);
- the note is shown to the human reviewer at disposition time, kept for later review, and explicitly labeled _agent self-report · unverified_;
- `<id>` must be a crossing on the **session-bound task** (resolved from `$CLAUDE_CODE_SESSION_ID`; cross-task targets and unbound/mismatched sessions are rejected);
- earlier explanations are immutable — a correction is a new note.

### Recording the user's ruling — `lumo crossing disposition` (LUM-769)

When the user has ruled on a crossing — in chat, after you relayed it — record
that ruling from the terminal instead of sending them to the web panel:

```bash
lumo crossing disposition <id> --false-positive --note "covered by the run-outbound tests"
```

It is a gated mutation on the [confirmation protocol](confirmation.md), as a **three-step** handshake — two envelopes, two separate approvals from the user, and the server enforces the order:

- **Step 1 — no step flag.** Reads the crossing, obtains a server-signed stage-1 **read receipt**, and prints an exit-4 envelope — severity, category, detail, `Seen ×N` when it recurred, every explanation you left (labelled _agent self-report · unverified_), the note, a `⚠` line saying that approving clears this crossing's block on DONE (plus `⚠ HIGH severity` / `⚠ Irreversible category` when they apply), and `Step 1 of 2 — read receipt issued … valid until <time>`. Nothing is written. Relay every line and **ask the user to confirm they have read it** — this envelope's `confirmCommand` ends in `--receipt <r1> --confirm-read`, not `--confirm`;
- **Step 2 — `--confirm-read --receipt <r1>`**, only after the user says they read it. The server verifies r1 and returns the stage-2 receipt; the CLI prints a second exit-4 envelope for the ruling itself — `Read acknowledged … (shown <t1>, acknowledged <t2>)`, `Step 2 of 2 — record the ruling: OPEN → FALSE_POSITIVE`, the note, the ⚠ consequence line. Still nothing written. Relay it and **ask the user to approve the ruling** — its `confirmCommand` ends in `--receipt <r2> --confirm`;
- **Step 3 — `--confirm --receipt <r2>`**, only after the user approves. POSTs the ruling (`FALSE_POSITIVE` | `CONFIRMED`, optional note, the stage-2 receipt); either value clears that crossing's DONE block, and the audit row records the shown / read-acknowledged / confirmed times. The web panel can still correct it later. **Never add `--confirm-read` or `--confirm` yourself** — each is the user's approval of that step, and the server records the ruling as a CLI-channel disposition (shown as _via CLI_ in the panel) precisely because it cannot verify the in-chat approvals;
- **the receipts are the server's ordering check** (LUM-769): each is bound to the crossing, the ruling, your session/member and the crossing's state at read time, and expires after 10 minutes. Confirming the ruling with the stage-1 receipt (read not yet acknowledged) is refused — locally before any request, and by the server with 409 — and told to run `--confirm-read` first; a step flag without its receipt, or both step flags at once, is refused locally; a receipt that is forged, expired, for another reader/ruling, or older than the crossing's latest change (a recurrence, a new explanation, a ruling) is refused by the server with 409 and nothing is written — re-run without a step flag for a fresh envelope. If the server cannot issue receipts (no signing secret configured) step 1 fails closed and no envelope is printed;
- the crossing is read first on both paths: a read that errors **fails closed** (exit 1, nothing written), an id not on the task is exit 1, and an already-matching ruling is a no-op (exit 0);
- `<id>` resolves against the **session-bound task**; `--task <LUM-N>` overrides the binding (e.g. from a terminal with no session, or after DONE unbinds you);
- **still web-only:** reverting a ruling to OPEN, repository suppression rules (LUM-751), and steward milestone crossings (`STEWARD_IMPLEMENTATION_ARTIFACT` has no task).

After the last blocker is cleared, re-run the original `lumo task update <id> --status done --confirm` — its envelope was already approved.

### --json contract

`--json` emits the full read model with a top-level `version` field (currently
`1`). The schema is versioned: breaking shape changes bump the major; additive
fields don't. Pin on `version` when scripting against it.

- each criterion carries `machinePassed` (boolean — a checkpointer currently vouches for it);
- the payload carries a top-level `machineVerification` aggregate `{ total, machineVerified, humanOverridden }` over the active MACHINE criteria — read these, not `latestVerdict` alone, to tell a machine-verified criterion from a human override;
- open boundary crossings ride along as an additive top-level `openCrossings`, each entry `{ id, category, severity, detail, attribution }` where `attribution` is `{ workspaceMemberId, sessionId, agent, worktreeBranch, model }` with every field nullable — null = unknown, never fabricated; the array length is the count. Same read-only awareness, no write path;
- **`openCrossings` is `null` when the crossings check failed** — distinct from `[]` (a successful read with zero open crossings). Script consumers must treat `null` as "unknown / could not confirm", **not** "safe".
- `nextActions` entries carry a `kind` discriminator (LUM-737): `CRITERION` (the pre-737 shape: `criterionId`, `statement`, `verifierType`, `checkpointer`, `judgeSteps`, `source`, `addedAtRound`, `rejectionReason`) or `SECURITY_FINDING` (`findingId`, `statement`, `severity`, `provenance`, `blocking`, `prNumber`, `ruleId`, `filePath`, `line`) or `TEST_CASE` (LUM-807: `statement`, `command`, `advisory: true` — an advisory row on a task that has a PR but no recorded test case; it carries no `blocking` field, is not counted in `N unmet`, and the DONE gate never reads it — see [test-cases.md](test-cases.md)). or `COVERAGE_GAP` (LUM-815: `criterionId`, `statement`, `command`, `advisory: true` — an acceptance criterion that no test case covers; like `TEST_CASE` it carries no `blocking` field, is not counted in `N unmet`, and the DONE gate never reads it. **`criterionId` alone no longer identifies a criterion row** — discriminate on `kind` / `verifierType`). Additive — a missing `kind` means `CRITERION`; do not index every entry by `criterionId`;
- a top-level `securityFindings` summary `{ open, blocking, unconfirmedPrs: [{ number, reason: NONE|FAILED|PENDING|RUNNING }], scans?: [{ prNumber, status, stages, partial, error, externalFindings, openFindings }] }`; **`null` means the scan read failed** — treat as "unknown / could not confirm", not "safe". `scans` is additive (LUM-735) — absent against an older server, one entry per linked PR with a latest scan otherwise.

`status` reads; `verify` judges. Running status never starts a round, never
escalates, and never changes task state — loop rules (the workspace round cap,
IN_REVIEW on all-pass, human-only DONE) live entirely in `lumo verify` and the
server.

## Verdict channels

`lumo verify` is the MACHINE channel. The only other channel is the **human**
one: a person records PASS or a send-back (FAIL) in the web verdict bar (Clerk
session). There is no agent-facing verdict command — the former
`lumo verdict --fail` AGENT send-back was removed in LUM-733 (17 rows all-time,
none in the last 30 days); when the machine loop runs out of rounds the task is
escalated to a human instead. **No passing data row is ever agent-produced.**

### The DONE gate

Once any criterion's latest verdict is FAIL — machine or human — moving
the task to DONE on the agent/CLI path is refused with **409** and the unresolved
items listed. Clear the send-back (fix + re-verify, or a human PASS) before
`lumo task update <id> --status done` — which itself walks the confirmation
protocol: without `--confirm` it exits 4 with an envelope for the user to
approve, and when the server gate still refuses it exits 5 with a structured
`DONE_BLOCKED` error listing every blocker (LUM-755, see [tasks.md](tasks.md)
and [confirmation.md](confirmation.md)).

- A task with no criteria, or whose criteria were never adjudicated, transitions freely — **the gate only blocks an actual send-back, never an un-adjudicated criterion.**
- When the machine loop has left a task IN_REVIEW with no send-back standing, the agent may move it to DONE directly; a human-PASS row is a provable manual override, not a required ticket.

## When a defect appears — fix in place, don't spin off a new task

On a send-back **or** a self-review finding: if the issue falls under any existing
acceptance criterion of **this** task, fix it in place and re-run `lumo verify`.
**Do not** `lumo task create` for it. New tasks are only for work genuinely
_outside_ this task's acceptance contract. Creating a task (and PR) for in-scope
rework launders a first-attempt failure — it bypasses the DONE gate's send-back
protection and corrupts the flywheel signal.

This is enforced: when you're mid-task, `lumo task create` refuses the bare form
and makes you declare intent:

- `lumo task create --rework-of <id>` — redirects you back to fix the existing task and creates nothing;
- `lumo task create --new-scope` — genuinely new, separate work.

If the send-back reveals the **contract itself** was wrong, amend it on this task
(`lumo task criteria set`) rather than opening a new task — see criteria.md.

**Hard rule:** while THIS task has an unresolved send-back (any criterion's latest
verdict is FAIL — the same condition that blocks DONE), `lumo task create` is
refused with **409 even with `--new-scope`**. A standing send-back means the task
can't be completed yet; resolve it (fix + `lumo verify`, or amend the contract)
before opening any new work. `--rework-of` still redirects you to it.

## Human-reported defects, once a task is submitted

When someone reports a defect in conversation, your action depends on whether the
task has **ever entered IN_REVIEW**:

- **Not yet** (still your first working pass) → just fix it and continue. No verdict needed — nothing was claimed complete, so there's nothing to contradict.
- **Already submitted** (entered IN_REVIEW / DONE / merged) → **do not silently fix and re-pass.** Ask the reporter to record a human send-back (FAIL) via the web verdict bar / Slack — the only channel that can attribute it to a human — then fix in place and re-run `lumo verify` so the fix lands as a fresh machine round on the record.

If the defect is a **new requirement** not covered by any criterion, first
transcribe it with `lumo task criteria set --human`, then proceed. You can never
write a human _verdict_ — the terminal can't prove a human is behind the command
(attribution integrity, not anti-forgery).
