# Outcome well (post-hoc oracle) — `lumo outcome`

The **post-hoc outcome well** (LUM-598) is the single external oracle for correctness + fidelity. It records the real-world fate a delivery met **after** it shipped — facts the agent cannot construct and that occur post-delivery (a revert, a rollback, CI turning red, a reopen, a downstream redirect of the design).

## The one invariant: falsifier, not verifier

The well **only** ever produces a rejection. Its verdict space is exactly:

- `REJECTED` — the well holds ≥1 rejection signal (reality revoked / redid / bypassed the delivery).
- `INCONCLUSIVE` — no rejection on record.

There is **no `SATISFIED` / `PASS`**. "N sprints and nobody touched it" is the _absence_ of a rejection — satisfied, merely-tolerated, and never-noticed are externally indistinguishable — so it reads `INCONCLUSIVE`, never a pass. Treat `INCONCLUSIVE` as "could not confirm a rejection", not as approval.

## Collection (where signals come from)

- **Automatic** — a DONE task reopened (the lineage `REWORKED` transition) is folded into the well as a `REOPENED` signal. No action needed; it happens server-side.
- **Manual** — a human who observed reality reject a delivery records it with `lumo outcome record`. The `--note` is mandatory: it is the observed referent, frozen as evidence.

## `lumo outcome show <task>`

Read the well for a task — the verdict plus its backing signals.

```bash
lumo outcome show LUM-42
```

An empty well prints `INCONCLUSIVE` with the reminder that silence is not a pass. A non-empty well prints `REJECTED` and lists each signal (date, kind, source, note).

## `lumo outcome record <task> --note "<what reality did>" [--kind <kind>]`

Record one human-observed post-hoc rejection. Append-only — every call inserts a new signal; nothing is ever mutated or cleared.

```bash
lumo outcome record LUM-42 --note "reverted in #812 after a prod incident" --kind reverted
lumo outcome record LUM-42 --note "downstream rewrote the API shape this task introduced" --kind downstream_redirect
```

- `--kind` (case-insensitive, default `manual`): `reverted | rolled_back | ci_regression | downstream_redirect | bypassed | manual`. `reopened` is **not** a manual kind — it is owned by the automatic lineage fold.
- `--occurred-at <iso>` — when the event actually happened (defaults to now).

## `lumo outcome rate [--min N] [--json]`

The workspace-level **trust × post-hoc-fate** join (LUM-603). For every delivery that has a frozen forecast snapshot, it buckets the delivery by its **delivery-time forecast-confidence** (high / medium / low — the only trust axis frozen at delivery, recomputed from the snapshot's `cohortSize` / `tokenCostBasis`) and reports each bracket's post-hoc **REJECTED** rate from the well. The question it answers once data is sufficient: _do high-trust deliveries get rejected by reality less often than low-trust ones?_

```bash
lumo outcome rate
lumo outcome rate --min 20 --json
```

This is the falsifier discipline applied at the **query layer** — it refuses to manufacture a finding off a thin sample:

- A bracket with fewer than `--min` (default 10) deliveries reads **`insufficient`** with the rate withheld — the raw `rejected/delivered` counts are still shown, but never divided into a believable proportion.
- The per-bracket rate is an explicit **lower bound** on true failure: the well only records rejections, so a zero-signal delivery is `INCONCLUSIVE` (counted in the denominator), never "satisfied".
- The headline **high-vs-low** comparison asserts a direction **only** when both brackets are measured _and_ their 95% confidence intervals are disjoint; otherwise it stays **`inconclusive`**.

**Expect `inconclusive` today.** The well is freshly wired and under-sampled — that is the designed state, not a bug. The same command produces real strata once enough post-hoc signals accumulate (the deferred outcome the skeleton exists to read).

> Scope note (debt-a): the trust axis is **task-level** forecast confidence only. Fragment-level trust is not frozen at delivery and drifts, so it is deliberately **not** joined here — doing so would read a post-hoc value against a past delivery. Freezing fragment trust is a separate follow-up.

## When to suggest

- A teammate says a shipped task **was reverted / rolled back / broke prod / got redone / was bypassed** — record it with `lumo outcome record` so the well carries reality's verdict.
- Auditing whether a "done" task actually held up — `lumo outcome show <task>` reads the well.
- Asking whether **higher-confidence deliveries actually fail less** (does delivery-time trust predict post-hoc fate?) — `lumo outcome rate`. Expect `inconclusive` until the well fills; it will never print a correlation the sample can't support.
- **Never** use it to mark something good: the well has no positive verdict by design. To assert a delivery met its contract, that is the acceptance loop (`lumo verify` / `lumo task status`), not the well.
