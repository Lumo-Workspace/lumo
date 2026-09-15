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

The shell-output compressor is off by default (LUM-787); set
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
is the pre-deploy evidence attached to LUM-787 — the third of three replays
of PR 1008 (head `02cf887c`), 2026-09-15:

| run | change under test                                                     | result                                                                                                                                                                                                     |
| --- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | step ceiling + elision + growth-priced stop                           | t1 5 steps / budget; t2, t3 `timeout` at step 2 — six compressions, none usable, ≤15 s each; 2 refusals (`;`-chained `echo`, `ls`)                                                                         |
| 2   | + compressor off by default, prompt forbids chaining                  | 0 refusals, 0 timeouts, wrap-up ran on all three; but 0/3 `done`, t2 3 steps — the gauge sat at the tail of the system prompt and was ignored, and growth pricing over-charged the step after a big result |
| 3   | + gauge as trailing user message, next step = pricier of the last two | **3/3 `done`** (5 / 4 / 4 steps, no wrap-up needed), 0 refusals, 12–14k tokens per task                                                                                                                    |

The production row these were replayed against had all three tasks stopped
`budget` at step 2–3, 0 candidates, two `no-budget` wrap-ups.
