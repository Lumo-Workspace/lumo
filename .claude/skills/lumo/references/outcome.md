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

## `lumo outcome rate [--min N] [--json]`

The workspace-level **trust × post-hoc-fate** join (LUM-603, LUM-606). For every delivery that has a frozen forecast snapshot, it buckets the delivery by its **delivery-time verification friction** — two raw counts (`verificationRounds`, `sendBackCount`) frozen at delivery from the append-only `VerificationRun` log, cut at `capturedAt`, then bucketed value-neutrally into `no-verification` / `single-round` / `multi-round-or-sendback` — and reports each bucket's post-hoc **REJECTED** rate from the well. The friction axis replaced the original sample-size forecast-confidence axis (LUM-606), which saturated: every mature-project delivery landed in `high`, so `high`-vs-`low` could never compare. The question it answers once data is sufficient: _do deliveries that took more verification friction get rejected by reality more (fragility) or less (scrutiny) often?_ The bucket names carry **no** good/bad direction — the correlation, not the label, decides.

```bash
lumo outcome rate
lumo outcome rate --min 20 --json
```

This is the falsifier discipline applied at the **query layer** — it refuses to manufacture a finding off a thin sample:

- A bucket with fewer than `--min` (default 10) deliveries reads **`insufficient`** with the rate withheld — the raw `rejected/delivered` counts are still shown, but never divided into a believable proportion.
- The per-bucket rate is an explicit **lower bound** on true failure: the well only records rejections, so a zero-signal delivery is `INCONCLUSIVE` (counted in the denominator), never "satisfied".
- The **`single-round` vs `multi-round-or-sendback`** comparison asserts a direction **only** when both buckets are measured _and_ their 95% confidence intervals are disjoint; otherwise it stays **`inconclusive`**. `no-verification` is never a comparison arm (silence is not a friction level).

**Expect `inconclusive` today.** The well is freshly wired and the discriminating end of the friction axis is sparse (multi-round/send-back deliveries are rare) — that is the designed state, not a bug. The same command produces real strata once enough post-hoc signals accumulate against the populated friction buckets (the deferred outcome the skeleton exists to read).

> Scope note: friction is frozen **at delivery** and cut at `capturedAt`, so it is replayable and never reads a drifted current value. A delivery with no `VerificationRun` before capture is its own `no-verification` bucket — absence of verification is never folded into `single-round` (silence ≠ a clean pass).

## When to suggest

- Auditing whether a "done" task actually held up — `lumo outcome show <task>` reads the well.
- Asking whether **verification friction predicts post-hoc fate** (do harder-to-verify deliveries fail more, or less?) — `lumo outcome rate`. Expect `inconclusive` until the well fills; it will never print a correlation the sample can't support.
- **Never** use it to mark something good: the well has no positive verdict by design. To assert a delivery met its contract, that is the acceptance loop (`lumo verify` / `lumo task status`), not the well.
