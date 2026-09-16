# LUM-786 — injection → action correlation, and its backtest

Design task LUM-786 asked whether Lumo should correlate the untrusted content it
injects into an agent's context with the actions the agent takes afterwards, and
made the answer conditional on a retrospective validation against production
history: _if the historical candidates are noise, honestly don't build it._

**Verdict: don't build it.** Over all of production history (2026-06-07 →
2026-09-16), the criterion produced 2,056 reportable candidates; 67 of them were
read individually (all 7 escalated + a 60-row random sample of the advisory
ones) and **0 were true positives**. A matched 1:1 placebo arm — the same
criterion on fragments that were never injected into that session — scored
0.203 per pair against the real 0.316, so roughly **64% of every candidate is
explained by chance alone**.

The full reasoning, the six design decisions, and the conditions under which
this should be reopened are in the spec attached to the task as an artifact
(local working copy: `docs/superpowers/specs/2026-09-16-lum786-injection-to-action-design.md`).

## What is here

| File                 | What it is                                                                                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `correlate.ts`       | The criterion itself: literal extraction, novelty, verbatim reproduction, evidence tiers, exemptions. Pure — no DB, no network.                                                    |
| `backtest.ts`        | Read-only replay over production: rebuilds what each `LineageEdge` actually injected, scans the session's action stream, writes `results.json`. Also runs the matched placebo arm. |
| `adjudicate.ts`      | Folds `adjudications.json` (the per-candidate human reading) back into `results.json` and computes precision.                                                                      |
| `adjudications.json` | One row per judged candidate: verdict + why. Keyed so a backtest re-run re-attaches them.                                                                                          |
| `results.json`       | The committed read-out the spec's numbers come from.                                                                                                                               |
| `__tests__/`         | `correlate.test.ts` (the criterion is deterministic) · `results.test.ts` (the committed read-out has not rotted).                                                                  |

## Re-running it

Both commands run from the **main checkout** — a worktree has no
`.env.production`, and the prod URL lives there (the local `.env` points at an
empty dev database).

```bash
DOTENV_CONFIG_PATH=/abs/path/to/.env.production npx tsx -r dotenv/config \
  scripts/analysis/lum786-injection-action/backtest.ts --days 0
```

```bash
npx tsx scripts/analysis/lum786-injection-action/adjudicate.ts
```

The backtest is read-only (`findMany` only) and takes ~8 minutes against the
production database: it loads each session's hook-event stream once, in pages.

## The one thing to keep if everything else is deleted

The **matched placebo arm**. A "this content was injected, then the agent did
this" detector will always find something — the question is only whether it
finds more than the same criterion finds on pairs that never happened. Without
that denominator, 2,056 candidates reads as a working detector instead of as
noise.
