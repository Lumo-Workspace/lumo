# Outcome well (post-hoc oracle) — `lumo outcome`

The **post-hoc outcome well** (LUM-598) is the single external oracle for correctness + fidelity. It records the real-world fate a delivery met **after** it shipped — facts the agent cannot construct and that occur post-delivery (a revert, a rollback, CI turning red, a reopen, a downstream redirect of the design).

## The one invariant: falsifier, not verifier

The well **only** ever produces a rejection. Its verdict space is exactly:

- `REJECTED` — the well holds ≥1 rejection signal (reality revoked / redid / bypassed the delivery).
- `INCONCLUSIVE` — no rejection on record.

There is **no `SATISFIED` / `PASS`**. "N sprints and nobody touched it" is the _absence_ of a rejection — satisfied, merely-tolerated, and never-noticed are externally indistinguishable — so it reads `INCONCLUSIVE`, never a pass. Treat `INCONCLUSIVE` as "could not confirm a rejection", not as approval.

## Collection (where signals come from)

- **Automatic** — a DONE task reopened (the lineage `REWORKED` transition) is folded into the well as a `REOPENED` signal. No action needed; it happens server-side.
- **Git-derived** — a revert (or a content reversal) of the delivery's commits landing on the default branch is recorded from the push webhook as `REVERTED` / `DOWNSTREAM_REDIRECT` (LUM-607). No manual recording path exists any more: the former `lumo outcome record` command was removed in LUM-733 (it was never used — 0 MANUAL signals all-time); CI-derived signals (`CI_REGRESSION` / `ROLLED_BACK`) are a follow-up.

## `lumo outcome show <task>`

Read the well for a task — the verdict plus its backing signals.

```bash
lumo outcome show LUM-42
```

An empty well prints `INCONCLUSIVE` with the reminder that silence is not a pass. A non-empty well prints `REJECTED` and lists each signal (date, kind, source, note).

## When to suggest

- Auditing whether a "done" task actually held up — `lumo outcome show <task>` reads the well.
- **Never** use it to mark something good: the well has no positive verdict by design. To check what still stands between a task and DONE, that is `lumo task status` / `lumo task wrapup`, not the well.
