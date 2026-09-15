# LUM-787 — local hunt replay

Replays the L3 hunt for one pull request's head sha on this machine, through
the shipped pieces (trigger → sandbox → gate/redactor/compressor/per-step
ledger → `huntTask` against the real model), and prints a `huntAudit.tasks[]`-
shaped read-out. It exists so a change to the hunt's budget arithmetic can be
judged on a real search **before** it is deployed, on the same diff that
exposed the problem.

What it skips: the workflow, the database, and the production GitHub App
token (the clone credential is your own `gh auth token`; the checkout is then
scrubbed of it by `scrubCloneCredentials` exactly as in production).

## Run

```bash
vercel env pull /tmp/vercel-dev.env --environment=development --yes   # VERCEL_OIDC_TOKEN
VERCEL_OIDC_TOKEN="$(grep '^VERCEL_OIDC_TOKEN=' /tmp/vercel-dev.env | cut -d= -f2- | tr -d '"')" \
DOTENV_CONFIG_PATH="$(pwd)/.env.local" npx tsx -r dotenv/config \
  scripts/analysis/lum787-hunt-replay/replay.ts --pr 1008 --sha 02cf887c71ce603cba0158f4edb9017fb0e747d7
```

`--model` defaults to `HUNT_MODEL` (what production runs). The shell-output
compressor is off by default (LUM-787); set
`LUMO_HUNT_COMPRESS=on` to replay with it on and compare.

Flags: `--repo owner/repo` (default `Lumo-Workspace/lumo`), `--tasks <file>`
(default `pr<N>-tasks.json` beside the script), `--out <file>` (default
`results-pr<N>.json` beside the script), `--diff-file <file>` (skip `gh pr
diff`).

The tasks file is the planner's answer for that scan, copied from the
production row's `huntAudit.planned`. An objective of `null` means "the
deterministic fallback for this category" — a floor-forced task is briefed
the way production briefs it today, not the way it was briefed in the row.

## Reading the result

The read-out is `formatShellDetail` from the LUM-739 audit, so it prints like
a production row: per command `[chars, compressed, clipped]`, per step
`in= out= elided=`, then `stop: … · next N · K steps` and the wrap-up line.
The `acceptance` block at the end applies LUM-787's contract: ≥ 2 of 3 tasks
`done`, every task ≥ 4 steps, gate refused 0.

`results-pr*.json` files are run output; the committed `results-pr1008.json`
is the pre-deploy evidence attached to LUM-787: PR 1008 (head `02cf887c`)
on the shipped `HUNT_MODEL` (qwen3-coder-plus) at the raised 30k per-task
ceiling — 2/3 `done`, 9 / 8 / 9 steps, refused 0, 23.6–26.8k tokens per
task (the 20k run of the same model went 3/3 `done` at 6 / 5 / 5 steps). The fix itself was tuned on
DeepSeek V4-Pro over three replays, 2026-09-15:

| run | change under test                                                     | result                                                                                                                                                                                                     |
| --- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | step ceiling + elision + growth-priced stop                           | t1 5 steps / budget; t2, t3 `timeout` at step 2 — six compressions, none usable, ≤15 s each; 2 refusals (`;`-chained `echo`, `ls`)                                                                         |
| 2   | + compressor off by default, prompt forbids chaining                  | 0 refusals, 0 timeouts, wrap-up ran on all three; but 0/3 `done`, t2 3 steps — the gauge sat at the tail of the system prompt and was ignored, and growth pricing over-charged the step after a big result |
| 3   | + gauge as trailing user message, next step = pricier of the last two | **3/3 `done`** (5 / 4 / 4 steps, no wrap-up needed), 0 refusals, 12–14k tokens per task                                                                                                                    |

The production row these were replayed against had all three tasks stopped
`budget` at step 2–3, 0 candidates, two `no-budget` wrap-ups.

## Model comparison (same diff, same three tasks, `--model`)

Run after the LUM-787 fix, 2026-09-15, one replay each — a single sample per
model, so read the shape, not the decimals. "text" = steps in which the model
wrote prose between tool calls (what survives elision); cost is the search's
token bill at the gateway's list price.

| model                            | done | steps (stop)                    | tokens | elapsed | reasoning tok | text  | candidates | est. cost |
| -------------------------------- | ---- | ------------------------------- | ------ | ------- | ------------- | ----- | ---------- | --------- |
| `deepseek/deepseek-v4-pro`       | 3/3  | 5 / 4 / 4 (done, done, done)    | 40,424 | 64s     | 1298          | 0/13  | 0          | $0.030    |
| `alibaba/qwen3-coder-plus`       | 2/3  | 6 / 5 / 6 (done, budget, done)  | 47,819 | 50s     | 0             | 17/17 | 1          | $0.053    |
| `alibaba/qwen3-coder-plus` (2nd) | 3/3  | 6 / 5 / 5 (done, done, done)    | 42,339 | —       | 0             | —     | 1          | ≈$0.05    |
| `alibaba/qwen3.7-plus`           | 2/3  | 6 / 5 / 3 (done, done, timeout) | 30,155 | 86s     | 1261          | 0/14  | 0          | $0.019    |
| `zai/glm-5.2`                    | 3/3  | 4 / 5 / 5 (done, done, done)    | 41,224 | 95s     | 2865          | 9/14  | 0          | $0.041    |
| `zai/glm-5.3-flash`              | 3/3  | 3 / 5 / 5 (done, done, done)    | 37,932 | 65s     | 2253          | 4/13  | 0          | $0.007    |

| `moonshotai/kimi-k2.5` | 0/3 | 2 / 2 / 2 (steps, steps, steps) | 16,721 | 25s | 0 | 1/6 | 0 | $0.011 |
| `moonshotai/kimi-k2.7-code` | 1/3 | 6 / 5 / 5 (done, timeout, budget) | 30,804 | 86s | 1726 | 0/16 | 0 | $0.048 |

Notes: `qwen3.7-plus` t3 hit the 40 s search window at step 3 (≈13 s per
step, no compressor involved); `glm-5.3-flash` t1 submitted at step 3 with a
reasoned "the flagged sink is a RegExp" — an early stop, not a starved one;
`qwen3-coder-plus` is the only model that narrates every step (17/17) and
the only one that submitted a candidate (rejected downstream: symbol ids off
the grammar) — and is what LUM-787 shipped as `HUNT_MODEL`, on the user's
call; `kimi-k2.5` stopped calling tools at step 2 in all three tasks —
it answered the first step with prose and no tool call, so the loop ended
(`steps`), and its forced wrap-up ignored `toolChoice` once. Step 2 is the
first step that carries the trailing budget message, so a Kimi-2.5 run with
the gauge off is the A/B still owed before blaming either side;
`kimi-k2.7-code` ran the loop normally (6 / 5 / 5).
