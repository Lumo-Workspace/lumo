# Fidelity read-outs (mechanical change-pattern)

`lumo fidelity` is the fidelity-axis read surface — pure, read-only analytics over what the acceptance loop already records, in the same family as `lumo criteria audit` and `lumo outcome rate`. It adds **no storage and no write path**; it only reads the LUM-609 delivery snapshots and the `CRITERION_CHANGED` audit trail.

## `lumo fidelity show <task>`

```bash
lumo fidelity show LUM-42
lumo fidelity show LUM-42 --json
```

For **each delivery** of the task (one append-only `TaskCriteriaSnapshot` per fresh IN_REVIEW entry — a reopen→re-deliver appends another), it discloses two compositions and deliberately stops there. There is **no single fidelity score and no good/bad direction verdict** — the read-out is purely mechanical (timing + op + checkpointer grounding; it never reads statement or diff semantics).

### 1. Grounding composition

Runs the same `effectiveReferentKind` classifier the LUM-605 verify gate uses over the **frozen** contract (delivery-time truth, not the since-edited `latest`), rolled into three buckets plus the full per-kind tally:

- **grounded** — `EXTERNAL_FACT` (anchored on a fact the agent cannot author: a git SHA/diff, CI status, a DB row). This count is a **machine-checkable _upper bound_** — the checkpointer heuristic can over-count external grounding, never under-count it.
- **self-confirming** — `AGENT_CONSTRUCTED_STATE` + `UNVERIFIED_ASSERTION` (passes by checking the agent's own output, incl. a declared-EXTERNAL_FACT checkpointer that doesn't truly ground external).
- **inconclusive** — `PENDING_OUTCOME` + `UNCLASSIFIED` (not mechanically resolvable here). **Surfaced, never silently swallowed.**

### 2. Independence signal

A criterion is a **backward-inference suspect** when it is both (a) in this delivery's frozen contract and (b) was `ADDED`/`UPDATED` at **round>0** (after work started) at or before the freeze — i.e. the contract the delivery rode on was bent after the work began rather than fixed up front. round-0 (initial-draft) criteria are clean; `DELETED` ops and edits recorded after the freeze (a later cycle) don't count. Each suspect shows its `op`, `round`, and `causeTag`. The read-out **counts and discloses — it does not judge** whether a given edit was legitimate sharpening or tampering (that direction call is left to a human / a later axis).

### Caveat (printed on every report)

The time anchor is the **work-start boundary** (`Task.workStartedAt`), so the independence signal detects a contract edited _after work started_ — not specifically _after output was produced_. A task with **no delivery snapshot** (never entered IN_REVIEW, or predates the LUM-609 freeze) is reported explicitly — "nothing to read yet", which is **not** a pass.

`--json` emits the full report (`taskId`, `workStartedAt`, `hasSnapshots`, `deliveries[]` with `grounding`/`independence`, `caveat`) for scripting.

**When to suggest**: when the user wants to see how externally-grounded a task's delivered acceptance contract actually was, or whether criteria were added/changed after work began (independence). It's a disclosure tool, not a gate — it never blocks DONE and emits no verdict.
