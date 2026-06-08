# LUM-314 — Automate fragment-usage voting: task-completion evidence judge

**Date**: 2026-06-07
**Branch**: `lumo/LUM-314-automate-fragment-usage-voting`
**Milestone**: Context Lineage (System of Record)

## Problem

LUM-300 built the machinery for a "real usage" lineage signal (`LineageEdge.used/usedAt`,
the `session wrap --used` vote, `usageMergeRateByFragments`), but it is **dormant**: in
production all ~1084 lineage edges have `used = NULL` because the vote depends on a user
manually running `session wrap --used`, and nobody does. A signal that needs a human
trigger is a dead signal — it starves the downstream consumers (LUM-279 ranking, LUM-303
trust badge) of real data.

This task makes the usage vote happen **automatically and honestly**.

## Core trap (non-negotiable)

The vote must NOT come from the working agent introspecting "which context did I use?".
LLMs cannot reliably self-attribute influence and will over-claim — re-creating exactly the
"fake 100%" non-discrimination that LUM-300 just removed, only wearing a confident face.

**Principle: a signal that looks real but is fake is worse than an honest NULL.**

Therefore: vote `used = true` only on concrete, mechanically-grounded evidence; abstain
(leave NULL) otherwise; **never** batch-write `false` in automatic mode.

## Key decisions (approved)

1. **Trigger = server-side task→DONE, not a CLI session-end hook.** The vote is produced as
   a background side effect of task completion, in the same seam that already fires lineage
   outcome-stamping and Layer-2 memory consolidation. This is strictly better than a client
   `SessionEnd` hook: reliable (can't be missed by a killed terminal), `outcome` is known at
   that instant (so `used` and `outcome` land together), and it only spends LLM judgement on
   tasks that reach a terminal state — which is exactly the population the resolved-only
   flywheel signal cares about. (Deliberate deviation from the task's literal wording.)

2. **Evidence base = server-side compacted event log, not the full transcript.** The full
   transcript stays on the user's machine; the server persists a compacted event log per
   session (`HookEvent`: every Read/Edit/Write/Bash with file paths + commands, each turn's
   `last_assistant_message`, turn summaries). This is a record of what the agent *mechanically
   did* — harder to fake than conversational self-report, and the honest realization of
   "evidence-driven, not self-introspection".

3. **Vote semantics = additive true-only; respect human votes.** A new additive mode of
   `applyUsageVote` writes `used = true` on confirmed refs and leaves everything else NULL.
   If a session already carries any human vote (`usedAt` set on any of its edges), the auto
   pass skips that session entirely (human is authoritative).

4. **Validation = lightweight offline audit + tests now; runtime trust-gate deferred.** This
   PR surfaces a signal-health view (distribution, per-session variance, used×outcome
   correlation) and unit tests asserting the judge abstains without evidence. It does **not**
   touch `computeFragmentTrust`'s runtime ranking — that is LUM-279's territory.

5. **Judge model = Haiku 4.5 first**, escalate to Sonnet only if the signal-health view shows
   low discriminative power.

## Architecture

Data flow:

```
task → DONE
  └─ updateTaskWithSideEffects (task-state.service.ts, DONE branch)
       └─ waitUntil( fragmentUsageAuditService.auditForTask(taskId) )
            └─ for each session of the task NOT yet voted:
                 ├─ resolve fragment content from DB (per fragmentType)
                 ├─ load the session's compacted event log
                 ├─ usageJudge.judge(fragments, eventLog)  → confident-used refs only
                 └─ lineageEdgeRepository.applyUsageVote(sessionId, refs, { mode: 'additive' })
```

Backstop: the existing hourly cron `app/api/cron/backfill-lineage-outcomes` gains a bounded
pass that audits not-yet-voted sessions of DONE tasks. Its first runs wake the dormant
production backlog; it processes a capped batch per run (logging how many were deferred — no
silent truncation) so it drains over a few hours instead of bursting thousands of LLM calls.

### Modules (layered architecture)

| Module | Responsibility |
| --- | --- |
| `lib/services/lineage/fragment-usage-audit.service.ts` | Orchestrate: enumerate sessions for a task, skip already-voted/already-audited, resolve content, call judge, apply vote. Owns the per-session concurrency claim. |
| `lib/services/lineage/usage-judge.ts` | Build the evidence-gated prompt, call the model (Haiku 4.5), return structured `{ fragmentType, fragmentId, evidence }[]` for confident-used only. AI-SDK imported dynamically (jest TransformStream trap). |
| fragment content resolver | Resolve `(fragmentType, fragmentId)` → display text per type (MEMORY / SLACK_CONTEXT / WEB_LINK / FIGMA / PR / PR_REVIEW_TODO / SESSION). Reuse the session-start section builders' resolution where possible; `resolveCanonicalFragment` resolves identity only, not content. |
| `lib/repositories/lineage-edge.repository.ts` | Extend `applyUsageVote` with `mode: 'additive'` (true-only, never touch the rest). Reuse `findSessionFragmentEdges` for the candidate set + already-voted check. |
| `lib/services/task-state.service.ts` | Add the `waitUntil(auditForTask)` call to the existing DONE branch. |
| `app/api/cron/backfill-lineage-outcomes/route.ts` | Add the bounded backstop pass. |
| signal-health analysis | Read-only: `used` distribution, per-session variance, used×outcome merge-rate vs base. Surfaced via `lumo task lineage --signal`. |

### The judge prompt (evidence gate)

Input per session: (a) the candidate fragments with their re-resolved content, (b) the
compacted event log. Instruction: for each fragment, vote `used = true` **only** when a
concrete action in the log traces to it — an edit to a file the fragment names, a command the
fragment prescribes, a decision that cites the fragment's content — and attach the evidence
quote. If there is no concrete evidence, **abstain** (omit it). Output only the confident-used
fragments. Never emit "unused".

## Idempotency & concurrency

- `task → DONE`, PR-merge webhook, poller, and cron can all fire for the same task. Outcome
  stamping is already idempotent (STAMPABLE_FROM ladder). For usage:
  - **Already-voted guard**: a session with any `usedAt` set is skipped (covers human votes
    and prior auto runs).
  - **No schema column for concurrency.** Idempotency comes from the already-voted guard (a
    session with any usedAt-stamped edge is skipped) plus the idempotent additive write; a rare
    concurrent double-fire only wastes one cheap Haiku call, never corrupts data.
- The additive write itself is idempotent (re-stamping the same true refs is a no-op).
- `reopen → re-DONE`: new sessions enter the not-yet-voted set and get audited; old ones skip.

## Population & cost

- Only sessions of **resolved** tasks are ever judged. Tasks that never close contribute
  nothing to the resolved-only merge-rate signal, so judging them would be wasted cost. This
  is a feature: LLM spend lands only where it can affect the signal.
- First cron runs backfill the existing ~1084 dormant edges, bounded per run.

## CLI surface

`lumo task lineage <id>` gains a usage column on each fragment (`✓` used with evidence quote /
`·` abstained→NULL / `✗` unused only ever from a manual replace vote) and a `--signal` flag
for the workspace signal-health view. No CLI *command* is added or changed in its trigger
behavior, so `.claude/skills/lumo/SKILL.md` gets a one-line note: usage is now auto-audited at
task completion; `session wrap --used` remains the manual override.

## No web UI change

The web Lineage tab (LUM-297) is intentionally left untouched. Surfacing a per-fragment "used"
pill belongs to LUM-303 (trust badge); adding it here would be scope creep.

## Out of scope

- True causality (counterfactual re-runs) — v2.
- Relaxing into liberal voting to manufacture data — explicitly forbidden.
- Runtime trust-gating in `computeFragmentTrust` — LUM-279.
- Shipping full transcript content from the CLI — the event log is sufficient; noted as a
  possible future enhancement.

## Testing

- Unit: judge abstains on a no-evidence fixture, votes (with the right ref) on an
  evidence-present fixture → proves discriminative power at the test level.
- Unit: `applyUsageVote({ mode: 'additive' })` writes true on confirmed refs and leaves the
  rest NULL (never false); `mode: 'replace'` keeps existing behavior.
- Unit: `auditForTask` skips a session that already has a human vote; skips a never-voted
  session with no edges; claims/releases correctly under a simulated concurrent fire.
- Unit: signal-health computes distribution, variance, and used×outcome correctly on a fixture.
- Integration: task→DONE fires the audit via `waitUntil` (mock the judge).

## Success criteria

- A task reaching DONE auto-produces honest usage votes (`true` with evidence, or NULL) without
  any user action.
- `used` distribution across sessions is non-constant and `merge-rate(used)` is meaningfully
  above base rate (discriminative), verifiable via `lumo task lineage --signal`.
- No `false` is ever written by the automatic path.
- Existing manual `session wrap --used` behavior is preserved and authoritative.
