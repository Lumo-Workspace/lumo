# Acceptance criteria (contract)

The acceptance contract is a small set of structured criteria the task's work is verified against. The agent drafts it; the server validates and stores it; verification rounds (`lumo verify`) judge against it. Criteria are injected at session start and in `lumo task context` as the `## Acceptance criteria (contract)` section.

## When to draft — the golden rule

**Attach → read context → draft criteria → THEN write the first line of code.**

If `lumo task context` / session-start shows the draft reminder ("This task has no acceptance criteria yet. …") instead of a contract, you MUST draft and submit criteria before starting implementation:

1. Read the task description, comments, linked resources, and memory first — the contract distills what "done" means, so understand the task before writing it.
2. Draft **3–7 criteria** for a typical multi-file task (drafting guidance only — the server enforces no count; if you genuinely need more, merge related checks instead). Scale the count down for small tasks (see "Scale the contract to the task size").
3. `lumo task criteria set <task> --file <criteria.json>` — submit.

### The reference-class block (outside view) — LUM-497

Below the draft reminder you may see a `### Reference class (outside view)` block: mechanical statistics over **similar delivered tasks** — the send-back reasons they hit, how often their contract was still being written after work started, and the boundary crossings they tripped. It exists because an agent drafting its own acceptance criteria is systematically optimistic: you write down what you intend to build, not what tasks like this one historically got sent back for.

```
### Reference class (outside view)

Based on: 14 delivered tasks in milestone "Trust and cognitive load"

· Most common send-back reasons: evidence insufficient 5/14 · work did not match the criterion 3/14
· Contract still being written after work started: 9/14 deliveries
· Most common boundary crossing: edited a file a checkpointer depends on 3/14

Tasks here most often come back for insufficient evidence — what will your key criteria point at as proof?
```

**How to use it:** read the failure modes, then ask which of them this task can plausibly hit, and let that change what you write. "Evidence insufficient" leads the class → decide what your key criteria will actually point at as proof. "Work did not match the criterion" leads → check that your statements describe outcomes rather than the steps you plan to take.

**How NOT to use it — this is the failure mode the block itself is most likely to cause:** do not treat the lines as a checklist to be "covered". Adding one criterion per listed failure mode, or setting `evidenceRequired` on everything because evidence leads the distribution, inflates the criterion count without adding information and taxes every verification round. The trailing line is deliberately a **question, not an instruction** — answer it for this task.

Reading the numbers honestly:

- Counts are **raw fractions over a small class** (`5/14`), never percentages, on purpose — `5/14` is a handful of tasks, not a rate. Weight them accordingly.
- The block names its own class and sample size (`Based on: N delivered tasks in <scope>`) — a milestone-level class is far more relevant to your task than a team-level fallback. Check which one you got.
- **`Insufficient sample: …` is a correct, deliberate output**, not a failure or a missing feature. It means no scope reached the minimum class size (the block states the floor in its own message), and a distribution over fewer tasks would read as evidence while carrying none. Draft from the task itself and move on.
- A class with no recorded send-backs, post-start contract edits or crossings says so explicitly. That is a stated fact about the class, not missing data.

The block is derived server-side from delivery history; it is not a claim by any agent, and there is nothing to reply to or act on beyond your own drafting.

**The contract is editable until DONE — changes after work starts leave a recorded drift trail.** Behaviour changes at two thresholds tracked by `Task.workStartedAt` (set the first time the task leaves TODO; never resets even if the task bounces back to TODO):

| Stage                                                              | `criteria set` resubmit behaviour                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Work never started** (`workStartedAt` unset, still initial TODO) | Replaces the whole contract freely — full-group replace, recorded `AGENT_DRAFT@round0`. Iterate as much as needed during planning.                                                                                                                                                                                                      |
| **Work started** (task left TODO at least once)                    | Still allowed; applies an **identity-preserving diff** — CLI matches items to existing criteria by id (auto-attaching ids by exact-statement match), records each add/update/delete as a `CRITERION_CHANGED` drift event at the current round. **No 409.** Contract can be sharpened as understanding grows; every change is traceable. |
| **Task DONE**                                                      | Contract locks — resubmit rejected with **409**. Reopen the task (move back to in_progress) to change criteria, or use `--human`.                                                                                                                                                                                                       |

`--human` revisions are allowed in every non-DONE stage. One deletion rule holds across all stages:

- A criterion that **already has verification runs** is **soft-deleted** (kept for audit, runs preserved).
- A **run-free** criterion is **hard-deleted**.
- Either way, reword rather than delete when possible.

### A send-back may mean the contract was wrong — amend it, don't spin off

If a send-back reveals the **contract itself** was wrong or incomplete, **amend the criteria on this task** (`lumo task criteria set <id>`, and with `--human` annotate the reason via `--cause NEW_INFO | SCOPE_CHANGE | DRAFT_BLIND_SPOT`) and re-verify — **not** open a new task. Sharpening the contract as understanding grows is expected; that's what the drift trail is _for_.

**The line:** amending to reflect reality is legitimate; **weakening a criterion you were just FAILed on, purely to make it pass, is tampering** — audited, and counts as a failure either way. Deleting a failed criterion doesn't help: the DONE gate still blocks on its standing FAIL (the run is soft-deleted, the verdict survives).

## Scale the contract to the task size

The 3–7 range is calibrated for typical multi-file tasks. Criterion count must track the size of the work — it is not a fixed ritual:

- **Micro task** (fits a single session, blast radius of one or two files — a docs tweak, copy change, small targeted fix): **1–2 criteria IS a complete contract** — one targeted MACHINE criterion plus at most one HUMAN criterion.
- **Never pad toward the soft floor.** A filler criterion (a restated baseline, a third angle on the same check) dilutes the contract and taxes every verification round. For a micro task the below-minimum warning is expected — ignore it.
- **Shrink the contract, never skip it.** Every task drafts and locks a contract before the first line of code; task size only changes how many criteria that takes.

## How to write good criteria

- **Outcome-level definition of done, not micro-steps** — a verifiable result (`"lumo task criteria set rejects a second agent draft with 409"`), not a task step ("add a check in the service").
- **Repo-wide baselines don't take slots** — tests pass / `tsc --noEmit` clean / i18n locale parity / lint are already required by the repo's PR checklist; never spend one of your 3–7 criteria on them.
- `evidenceRequired: true` — marks criteria whose verdict must point at proof (a MACHINE PASS always requires evidence regardless of this flag).
- **Edited a MACHINE checkpointer mid-task? Re-run `lumo verify`.** A prior PASS was recorded against the old command — swapping the checkpointer (or rewording the criterion) makes that pass stale: `lumo task status` / the acceptance tab flag it `⚠ pre-edit version`. The stale pass still counts as met (render-only, doesn't block DONE), but re-verify so the green reflects the current check.

**MACHINE vs HUMAN:**

- `MACHINE` — an executable check exists. **Must** carry a `checkpointer` (the runnable check: a test command, script, probe…). The checkpointer runs on the agent's machine; the structured verdict is reported back to the server (execution on the client, adjudication on the server).
- `HUMAN` — needs human judgment (UX feel, copy tone, design fidelity).
- `checkpointer`-less MACHINE → demote to HUMAN — the server rejects checkpointer-less MACHINE criteria rather than silently rewriting them. Don't invent a fake checkpointer to keep it MACHINE.

**Two checkpointer traps:**

- `npx tsx scripts/jest-t.ts '<exact test name>' [test file path]` — jest-by-name checkpointers must go through this zero-match guard. A bare `npx jest -t '<name>'` exits 0 even when the pattern matches **no** test — rename or delete the test and the checkpointer silently fake-PASSes. `jest-t.ts` fails unless ≥1 matching test ran and passed; the optional path scopes the run to one file (much faster than name-filtering the whole suite).
- `instance-independent, never self-comparing` — a checkpointer is stored once and re-run for the life of the task, so it must not depend on a baseline that shifts under it. The trap is a `vs origin/main` self-comparison ("current file is strictly smaller than origin/main"): passes pre-merge, but the moment the change merges every branch cut from main has `current == base` and the check fails forever. Anchor to a **fixed, absolute target** — a literal budget (`byteCount ≤ 9500`), a committed fixture, or a stable named test through the zero-match guard. A jest-by-name checkpointer likewise rots when its test is renamed/deleted — often by _another_ task's work, so the stored PASS goes stale invisibly. Keep test names stable; `npx tsx scripts/checkpointer-drift.ts <LUM-N> | --mine` statically sweeps stored contracts for these zero-match checkpointers (detection-only).

### judgeSteps — agent-drafted judging steps for HUMAN criteria

**`referentKind` — derived by the system, not declared (LUM-733):**

You do not declare a referent kind. The server derives it from the checkpointer at write time and stores the result:

- MACHINE + a checkpointer that actually **consumes** an external tool (`git`/`gh`/`curl`/`psql`/`prisma migrate status`…, its exit or output reaching the verdict) → `EXTERNAL_FACT` — a fact the agent cannot author.
- MACHINE + anything else (`jest`/`vitest`/`tsc`/`node`/`tsx`, your own build or type-check) → `AGENT_CONSTRUCTED_STATE` — green is self-confirming, which is the honest kind for almost every code task's checks.
- HUMAN → no checkpointer to read; an optional `"referentKind": "EXTERNAL_FACT" | "AGENT_CONSTRUCTED_STATE"` is kept as-is, otherwise the row stays unclassified.

A `referentKind` on a MACHINE item is accepted for backward compatibility and ignored. `PENDING_OUTCOME` is no longer a task-criterion kind (it remains on milestone exit criteria only) — leave post-delivery truths out of the encoded contract. There is no verify-time gate to trip: because the kind follows the check, a jest-checked criterion can never be stored as an "external fact".

A HUMAN criterion is judged by a person, not a checkpointer — so don't hand them a bare assertion ("the copy reads naturally") and make them reverse-engineer what to do. Attach **`judgeSteps`**: short, human-readable instructions the adjudication card renders verbatim (light markdown, URLs made clickable). Structured labour is yours; the human just follows the steps.

**Shape — 1–3 steps, always in this order:**

1. `Where to look` — the exact link or path (a task URL, a tab, a file). Paste the real URL; the card / `lumo task status` render it clickable.
2. `What to do` — the concrete action ("open the acceptance tab", "read the `judgeSteps` block aloud", "resize to mobile width").
3. `✓ pass / ✗ send-back` — the decision rule, both directions, so the verdict isn't a coin-flip ("pass if every URL opens; send back if any step is vague").

**One criterion = one judgment point.** If a HUMAN criterion bundles two checks, split it — each half gets its own steps. The canonical miss is an "additive schema **and** self-credit not implemented" criterion: two assertions; the first is even machine-able (below), the second is a separate human read.

**Machine-able → make it MACHINE, don't burn human attention.** Before writing `judgeSteps`, ask whether a checkpointer could decide it. "The migration is purely additive" → `grep` the `migration.sql` for `DROP`/destructive DDL → MACHINE. "No file under `prisma/migrations/` was deleted" → a `git diff` probe → MACHINE. Reserve HUMAN + `judgeSteps` for genuine taste/feel/fidelity judgments a check can't make.

`judgeSteps` is **optional and non-blocking** — a HUMAN criterion without it still submits, but the server returns a soft warning (same channel as the 3–7 count warning) and the card shows a "no judging guidance" fallback. It is part of the contract: editing it drifts like any other field (`CRITERION_CHANGED` before/after carries it), and it survives a statement-only web edit.

```json
{
  "statement": "The acceptance tab reads as plain operational instructions, not agent-voice assertions",
  "verifierType": "HUMAN",
  "referentKind": "AGENT_CONSTRUCTED_STATE",
  "judgeSteps": "Open the task's Acceptance tab (the IN_REVIEW card). For each HUMAN criterion, read its 'How to judge' block. Pass if each one names where to look, what to do, and what counts as pass vs send-back; send back if any reads as a bare assertion with no steps."
}
```

### Invariant (negative-assertion) criteria

Most criteria assert that **something that should happen, happened** ("the endpoint returns 409", "the section renders"). An _invariant criterion_ asserts the dual: that **something that must not happen, didn't** — the change left an explicit don't-touch surface intact. This is the acceptance analogue of AppWorld's _collateral-damage_ checks (arXiv 2407.18901) and ToolSandbox's _minefield_ states (arXiv 2408.04682): a finished task is judged not only on the intended effect but on the forbidden effects it avoided. `lumo verify` already judges final state per round, so an invariant fits the existing machinery with no new mechanism — a drafting habit, not a feature.

- `When to write one` — add a single invariant criterion when the task has a concrete, nameable surface the change must not disturb: a data-destruction red line, a structure guard, an always-green baseline set, a diff that must stay in-bounds, a standing budget. Decision support, not a ritual: reach for it only when you can point at the surface. If the only invariant you can name is "don't break the build", that's already the repo's PR baseline (tests / `tsc` / lint / i18n parity) — don't spend a slot restating it.
- `How to phrase it` — state the invariant as _still holding after the change_, not as a step you took. The **c-CRAB boundary** is the hard rule: encode **"the problem does not (re)occur"**, never **"a specific fix exists"**. Write "`prisma/migrations/` has no deleted files vs origin/main" (the bad state is absent) — not "the migration-delete guard function is present" (a named fix). The first survives a refactor of _how_ the invariant is enforced; the second re-fails the moment someone renames the guard, and passes even if the protection was gutted some other way.
- `Pairing with a checkpointer` — an invariant almost always has a runnable check (its advantage), so prefer MACHINE. The existing `checkpointer` syntax carries it as-is: a `git diff` path/filter probe, a full-suite `jest` run, a structure-verify script, a parity check.

Two real-repo invariant examples — `prisma/migrations/` files never deleted (the CLAUDE.md red line), and a live-doc's table structure not flattened (an HTML→md round-trip that silently collapsed tables to plain text):

```json
[
  {
    "statement": "No file under prisma/migrations/ is deleted by this change (vs origin/main)",
    "verifierType": "MACHINE",
    "checkpointer": "bash -c \"test -z \\\"$(git diff --diff-filter=D --name-only origin/main -- prisma/migrations/)\\\"\""
  },
  {
    "statement": "Live-doc keeps its table structure after the edit (no rows/headings dropped)",
    "verifierType": "MACHINE",
    "checkpointer": "npx tsx scripts/verify-live-doc.ts <docId> docs/live-docs/<file>.md"
  }
]
```

A third example invariant is "SKILL.md frontmatter description stays ≤ 1000 chars" — the standing context-budget invariant (the description is resident in every session), checkpointed by the `description cap` case in `scripts/analysis/lum392-cli-friction/__tests__/doc-examples.test.ts`.

One invariant criterion is usually enough — it's the guardrail, not the whole contract. Pair it with the positive criteria that say what the change should achieve; together they assert _did the right thing_ **and** _touched nothing it shouldn't_.

## JSON file format

`criteria.json` is a JSON array; one object per criterion:

```json
[
  {
    "statement": "PUT /api/tasks/[id]/criteria rejects a second AGENT_DRAFT submission with 409",
    "verifierType": "MACHINE",
    "checkpointer": "npx jest __tests__/task-criteria.service.test.ts -t 'agent lock'"
  },
  {
    "statement": "The criteria section reads naturally as part of the task statement",
    "verifierType": "HUMAN",
    "referentKind": "AGENT_CONSTRUCTED_STATE",
    "judgeSteps": "Open the task's Acceptance tab. Read the contract top to bottom. Pass if it scans as one coherent definition of done; send back if a criterion reads as boilerplate or contradicts another."
  },
  {
    "statement": "Session-start injection shows the contract ahead of memory",
    "verifierType": "MACHINE",
    "checkpointer": "npx jest __tests__/cli/hook-runner-session-start-stdout.test.ts",
    "evidenceRequired": true
  }
]
```

Fields:

- `statement` — required, ≤2000 chars.
- `verifierType` — `"MACHINE"` | `"HUMAN"`.
- `checkpointer` — required for MACHINE.
- `referentKind` — optional and advisory; the stored kind is derived from the checkpointer (see "referentKind" above). Only meaningful on a HUMAN criterion (`"EXTERNAL_FACT"` | `"AGENT_CONSTRUCTED_STATE"`).
- `evidenceRequired` — optional, default false.
- `judgeSteps` — optional, ≤2000 chars; agent-drafted human-judging steps for a HUMAN criterion (see "judgeSteps" above).
- `id` — only in `--human` revisions (see below).

## Commands

### `lumo task criteria set <task> --file <criteria.json>`

Agent draft, recorded as `AGENT_DRAFT` at round 0. **Editable until DONE:** while `workStartedAt` is unset (task never left TODO) a resubmit replaces the whole contract (full-group baseline). Once work has started an agent resubmit applies an **identity-preserving diff** — matched by id, each add/update/delete recorded as a `CRITERION_CHANGED` drift event; no 409. The contract locks (409) only once the task is **DONE** — reopen it to change criteria, or use `--human`. A criterion that already has verification runs is soft-deleted (audit trail preserved); run-free criteria are hard-deleted. Echoes the stored criteria (with ids) plus the 3–7 soft-cap warning if outside range. `--file` must point inside the current project directory — write the JSON to the repo root or a subdirectory, not `/tmp`, and delete it after submission.

```bash
lumo task criteria set LUM-42 --file criteria-lum42.json
```

### `lumo task criteria set <task> --file <criteria.json> --human`

Record a **human contract revision** (HUMAN_EDIT), e.g. when the user changes the contract in conversation — you transcribe their decision. Allowed at any time, even after the agent lock. The file is the **desired final list**:

- `id` present (from `criteria list`) — keeps that criterion; changed fields update it and stamp it `HUMAN_EDIT`; identical fields leave it (and its provenance) untouched
- `id` absent — the item is created as `HUMAN_EDIT`
- `id` missing-from-file — existing criteria not in the file are **deleted**; refused with 409 if the criterion already has verification runs (reword it instead)

The revision is auto-recorded as a task comment with the session origin (`X-Lumo-Session-Id`). **Transcribing the contract is allowed; transcribing a verdict is never** — human verdicts only enter through human-initiated paths (web UI / Slack action), and the agent has no write path to them. Only use `--human` for decisions a human actually made (in conversation, in a comment, in review). Never use it to work around your own lock.

```bash
lumo task criteria set LUM-42 --file criteria-revision.json --human
lumo task criteria set LUM-42 --file criteria-revision.json --human --cause SCOPE_CHANGE
```

Optionally annotate **why** the contract drifted with `--cause <NEW_INFO|SCOPE_CHANGE|DRAFT_BLIND_SPOT|GRANULARITY|OTHER>` — pick the tag from the human's stated reason:

- `NEW_INFO` — new information.
- `SCOPE_CHANGE` — scope moved.
- `DRAFT_BLIND_SPOT` — the draft missed it.
- `GRANULARITY` — wrong granularity.
- `OTHER` — anything else.

The tag lands in the drift record (TaskActivity payload). Every criteria add/update/delete is mirrored as a structured `CRITERION_CHANGED` activity automatically; `--cause` just enriches it.

### `lumo task criteria list <task>`

Print the contract: `<id>  [MACHINE|HUMAN]  SOURCE@rN  [evidence]  statement` plus an indented `↳ check:` line for checkpointers. Use it to fetch ids before a `--human` revision. Empty contract prints a drafting pointer.

```bash
lumo task criteria list LUM-42
```

## Injection behavior

- **Session start** (bound task): the contract is the highest-priority section in the injection budget — ahead of memory/PR/Slack/Figma/web. If a still-open task has no criteria, the draft reminder is injected instead.
- **`lumo session attach`**: prints the contract (or the draft reminder) right after binding.
- **The reference-class block** rides on the draft reminder at all three of those surfaces, so it appears only when the task has no contract yet — the one moment it can still change what gets written. It is capped at a few lines, sits outside the injection budget, and is skipped silently if the read fails or the workspace has acceptance mode off.
- **`lumo task context`**: the `## Acceptance criteria (contract)` section appears after the task description, before memory.
- **Review-time gap findings** are appended at the round they surface and show up in the contract automatically — `REVIEW_ADDED` provenance via human review paths; findings a human raises in conversation are transcribed with `--human` + `--cause` (see verify.md "Review-time drift habits").

## After the contract: the verification loop

The contract is judged by `lumo verify` — run it before claiming the task is done. See [verify.md](verify.md) for the loop (a workspace-configurable round cap — `verificationMaxRounds`, default 3, shown as `Round N/M` in the output — IN_REVIEW on all-pass, escalation on a last-round fail).

## `lumo criteria audit` — workspace referent-kind analytics

```bash
lumo criteria audit
```

`lumo criteria audit` — workspace-level acceptance-criteria analytics. Calls `GET /api/criteria/audit` and prints two things:

1. **Declared-kind distribution** — count of criteria by effective referent kind:
   - `EXTERNAL_FACT` — declared as externally observable (git SHA, CI status, DB row) and the checkpointer invokes real external tooling
   - `AGENT_CONSTRUCTED_STATE` — passes by checking output the agent itself produced
   - `PENDING_OUTCOME` — deferred to post-hoc falsifier
   - `UNVERIFIED_ASSERTION` — a legacy row declared `EXTERNAL_FACT` (before LUM-733 derivation) whose checkpointer does **not** actually invoke external tooling (git/CI/HTTP); reported as-is. New rows can't land here — the kind is derived from the checkpointer at write time (see "referentKind")
   - `UNCLASSIFIED` — legacy rows predating the `referentKind` field (null in DB)

2. **Self-confirming-green headline ratio** — `(AGENT_CONSTRUCTED_STATE + UNVERIFIED_ASSERTION) / classified`. Criteria in these two buckets pass by confirming only the agent's own work, not an independent external state.

**When to suggest**: when the user wants to audit how much of the workspace's "green" criteria are self-confirming vs externally anchored; when diagnosing whether acceptance criteria have real external hooks or are circular.
