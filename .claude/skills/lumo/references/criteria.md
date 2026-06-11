# Acceptance criteria (contract)

The acceptance contract is a small set of structured criteria the task's work
will be verified against (Acceptance v1, LUM-341/342). The agent drafts it;
the server validates and stores it; verification rounds (`lumo verify`,
Slice 1 task #3) judge against it. Criteria are injected at session start and
in `lumo task context` as the `## Acceptance criteria (contract)` section.

## When to draft — the golden rule

**Attach → read context → draft criteria → THEN write the first line of code.**

If `lumo task context` / session-start shows the draft reminder ("This task
has no acceptance criteria yet. …") instead of a
contract, you MUST draft and submit criteria before starting implementation:

1. Read the task description, comments, linked resources, and memory first —
   the contract distills what "done" means, so understand the task before
   writing it.
2. Draft **3–7 criteria** for a typical multi-file task (soft range — the
   server warns outside it but never rejects; if you genuinely need more,
   merge related checks instead). **Scale the count down for small tasks** —
   see "Scale the contract to the task size" below.
3. Submit with `lumo task criteria set <task> --file <criteria.json>`.

**The lock is stage-based — free to iterate the draft while planning, locked
once work starts.** While the task is still **TODO** (the planning stage) you
may resubmit `criteria set` freely: a full-group resubmit replaces the whole
contract, still recorded as your `AGENT_DRAFT` (each add/change/delete leaves a
drift trail). The moment the task **leaves TODO** (work begins) the contract
locks for agent edits — from then on you (the agent) can NOT change your own
contract, only human revisions (`--human`) can. That's by design: once you're
building against it, the contract is what your work gets judged against, not a
to-do list you trim to fit what you built. (One exception holds in every stage:
a criterion that already has verification runs is never deleted — reword it.)

## Scale the contract to the task size

The 3–7 range is calibrated for typical multi-file tasks. The criterion count
must track the size of the work — it is not a fixed ritual:

- **Micro task** (expected to fit a single session, blast radius of one or
  two files — a docs tweak, a copy change, a small targeted fix): **1–2
  criteria IS a complete contract** — one targeted MACHINE criterion plus at
  most one HUMAN criterion.
- **Never pad toward the soft floor.** A filler criterion (a restated
  baseline, a third angle on the same check) dilutes the contract and taxes
  every verification round. For a micro task the below-minimum warning is
  expected — ignore it.
- **Shrink the contract, never skip it.** Every task still drafts and locks a
  contract before the first line of code; task size only changes how many
  criteria that takes.

## How to write good criteria

- **Outcome-level definition of done, not micro-steps.** A criterion states a
  verifiable result ("`lumo task criteria set` rejects a second agent draft
  with 409"), not a task step ("add a check in the service").
- **Repo-wide baselines don't take slots.** Tests pass / `tsc --noEmit` clean /
  i18n locale parity / lint are already required by the repo's PR checklist —
  never spend one of your 3–7 criteria on them.
- **MACHINE vs HUMAN:**
  - `MACHINE` = an executable check exists. It **must** carry a `checkpointer`
    (the runnable check: a test command, script, probe…). The checkpointer
    runs on the agent's machine; the structured verdict is reported back to
    the server (execution on the client, adjudication on the server).
  - `HUMAN` = needs human judgment (UX feel, copy tone, design fidelity).
  - **If you can't attach a checkpointer to a MACHINE criterion, demote it to
    HUMAN** — the server rejects checkpointer-less MACHINE criteria rather
    than silently rewriting them. Don't invent a fake checkpointer to keep it
    MACHINE.
  - **Jest-by-name checkpointers must go through the zero-match guard.** A
    bare `npx jest -t '<name>'` exits 0 even when the pattern matches **no**
    test — rename or delete the test and the checkpointer silently fake-PASSes
    (same trap class as the BSD-grep `-P` incident, LUM-401). Write
    `npx tsx scripts/jest-t.ts '<exact test name>' [test file path]` instead:
    it fails unless ≥1 matching test ran and passed. The optional path scopes
    the run to one file (much faster than name-filtering the whole suite).
- `evidenceRequired: true` marks criteria whose verdict must point at proof
  (a MACHINE PASS always requires evidence regardless of this flag).

### Invariant (negative-assertion) criteria

Most criteria assert that **something that should happen, happened** ("the
endpoint returns 409", "the section renders"). An _invariant criterion_ asserts
the dual: that **something that must not happen, didn't** — the change left an
explicit don't-touch surface intact. This is the acceptance analogue of
AppWorld's _collateral-damage_ checks (arXiv 2407.18901) and ToolSandbox's
_minefield_ states (arXiv 2408.04682): a finished task should be judged not only
on the intended effect but on the forbidden effects it avoided. `lumo verify`
already judges final state per round, so an invariant fits the existing
machinery with no new mechanism — it's a drafting habit, not a feature.

**When to write one.** Add a single invariant criterion when the task has a
concrete, nameable surface the change must not disturb — a data-destruction red
line, a structure guard, an always-green baseline set, a diff that must stay
in-bounds, a standing budget. It is decision support, not a ritual: reach for it
only when you can point at the surface. If the only invariant you can name is
"don't break the build", that's already the repo's PR baseline (tests / `tsc` /
lint / i18n parity) — don't spend a slot restating it.

**How to phrase it.** State the invariant as _still holding after the change_,
not as a step you took. The **c-CRAB boundary** is the hard rule: the check
encodes **"the problem does not (re)occur"**, never **"a specific fix exists"**.
Write "`prisma/migrations/` has no deleted files vs origin/main" (the bad state
is absent) — not "the migration-delete guard function is present" (a named fix).
The first survives a refactor of _how_ the invariant is enforced; the second
re-fails the moment someone renames the guard, and passes even if the protection
was gutted some other way.

**Pairing with a checkpointer.** An invariant almost always has a runnable check
— that's its advantage — so prefer MACHINE. The existing `checkpointer` syntax
carries it as-is: a `git diff` path/filter probe, a full-suite `jest` run, a
structure-verify script, a parity check. Two real-repo examples:

- **`prisma/migrations/` files are never deleted** (the CLAUDE.md red line). The
  bad state is a deleted migration file in the diff:

  ```json
  {
    "statement": "No file under prisma/migrations/ is deleted by this change (vs origin/main)",
    "verifierType": "MACHINE",
    "checkpointer": "bash -c \"test -z \\\"$(git diff --diff-filter=D --name-only origin/main -- prisma/migrations/)\\\"\""
  }
  ```

- **A live-doc's table structure is not flattened** (the LUM-349 incident: an
  HTML→md round-trip silently collapsed tables to plain text). The verify script
  hard-fails if any table / row / heading count shrank:

  ```json
  {
    "statement": "Live-doc keeps its table structure after the edit (no rows/headings dropped)",
    "verifierType": "MACHINE",
    "checkpointer": "npx tsx scripts/verify-live-doc.ts <docId> docs/live-docs/<file>.md"
  }
  ```

A third lives in a current contract you can copy: **LUM-415**'s "SKILL.md
frontmatter description stays ≤ 1000 chars" — the standing context-budget
invariant (the description is resident in every session), checkpointed by the
`description cap` case in
`scripts/analysis/lum392-cli-friction/__tests__/doc-examples.test.ts`.

One invariant criterion is usually enough — it's the guardrail, not the whole
contract. Pair it with the positive criteria that say what the change should
achieve; together they assert _did the right thing_ **and** _touched nothing
it shouldn't_.

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
    "verifierType": "HUMAN"
  },
  {
    "statement": "Session-start injection shows the contract ahead of memory",
    "verifierType": "MACHINE",
    "checkpointer": "npx jest __tests__/cli/hook-runner-session-start-stdout.test.ts",
    "evidenceRequired": true
  }
]
```

Fields: `statement` (required, ≤2000 chars), `verifierType` (`"MACHINE"` |
`"HUMAN"`), `checkpointer` (required for MACHINE), `evidenceRequired`
(optional, default false), `id` (only in `--human` revisions — see below).

## Commands

### `lumo task criteria set <task> --file <criteria.json>`

Agent draft, recorded as `AGENT_DRAFT` at round 0. **Stage-based lock:** while
the task is **TODO** a resubmit is allowed and replaces the whole contract
(full-group), so you can iterate the draft during planning; once the task has
**left TODO** a resubmit is rejected with 409 — from there only `--human`
revisions change the contract. (Deleting a criterion that already has
verification runs is refused in every stage — reword it instead.) Echoes the
stored criteria (with ids) plus the 3–7 soft-cap warning if outside range.

```bash
lumo task criteria set LUM-42 --file criteria-lum42.json
```

(`--file` must point inside the current project directory — write the JSON to
the repo root or a subdirectory, not `/tmp`, and delete it after submission.)

### `lumo task criteria set <task> --file <criteria.json> --human`

Record a **human contract revision** (HUMAN_EDIT), e.g. when the user changes
the contract in conversation — you transcribe their decision. Allowed at any
time, even after the agent lock. The file is the **desired final list**:

- items carrying an `id` (from `criteria list`) keep that criterion — changed
  fields update it and stamp it `HUMAN_EDIT`; identical fields leave it (and
  its provenance) untouched
- items without `id` are created as `HUMAN_EDIT`
- existing criteria missing from the file are **deleted** — refused with 409
  if the criterion already has verification runs (reword it instead)

The revision is auto-recorded as a task comment with the session origin
(`X-Lumo-Session-Id`). **Transcribing the contract is allowed; transcribing a
verdict is never** — human verdicts only enter through human-initiated paths
(web UI / Slack action), and the agent has no write path to them.

Only use `--human` for decisions a human actually made (in conversation, in a
comment, in review). Never use it to work around your own lock.

```bash
lumo task criteria set LUM-42 --file criteria-revision.json --human
lumo task criteria set LUM-42 --file criteria-revision.json --human --cause SCOPE_CHANGE
```

Optionally annotate **why** the contract drifted with
`--cause <NEW_INFO|SCOPE_CHANGE|DRAFT_BLIND_SPOT|GRANULARITY|OTHER>` — pick
the tag from the human's stated reason (new information, scope moved, the
draft missed it, wrong granularity). The tag lands in the drift record
(TaskActivity payload), feeding the Slice-3 drift-cause distribution. Every
criteria add/update/delete is mirrored as a structured `CRITERION_CHANGED`
activity automatically; `--cause` just enriches it.

### `lumo task criteria list <task>`

Print the contract: `<id>  [MACHINE|HUMAN]  SOURCE@rN  [evidence]  statement`
plus an indented `↳ check:` line for checkpointers. Use it to fetch ids
before a `--human` revision. Empty contract prints a drafting pointer.

```bash
lumo task criteria list LUM-42
```

## Injection behavior

- **Session start** (bound task): the contract is the highest-priority
  section in the injection budget — ahead of memory/PR/Slack/Figma/web. If a
  still-open task has no criteria, the draft reminder is injected instead.
- **`lumo session attach`**: prints the contract (or the draft reminder) right after
  binding.
- **`lumo task context`**: the `## Acceptance criteria (contract)` section appears after the
  task description, before memory.
- Review-time gap findings are appended at the round they surface and show up
  in the contract automatically — `REVIEW_ADDED` provenance via human review
  paths; findings a human raises in conversation are transcribed with
  `--human` + `--cause` (see verify.md "Review-time drift habits").

## After the contract: the verification loop

The contract is judged by `lumo verify` — run it before claiming the task is
done. See [verify.md](verify.md) for the loop (round cap 3, IN_REVIEW on
all-pass, escalation on a round-3 fail).
