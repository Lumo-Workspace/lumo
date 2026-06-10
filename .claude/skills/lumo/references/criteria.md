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
   Submission **locks the contract for agent edits** — get it right before
   submitting, because afterwards only human revisions (`--human`) can change it.

Once you (the agent) have started work, you can NOT change your own contract.
That's by design: the contract is what your work gets judged against, not a
to-do list you trim to fit what you built.

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
- `evidenceRequired: true` marks criteria whose verdict must point at proof
  (a MACHINE PASS always requires evidence regardless of this flag).

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

Initial agent draft. Creates the whole contract as `AGENT_DRAFT` at round 0.
Rejected with 409 once **any** criteria exist on the task — the agent lock.
Echoes the stored criteria (with ids) plus the 3–7 soft-cap warning if
outside range.

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
