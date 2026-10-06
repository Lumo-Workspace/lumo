# LUM-988 — AI review replay on the Martian Code Review Bench

Replays the PR scan's AI review (`judgeSecurity`, general code review on
`CODE_REVIEW_MODEL` with the changed files as context) over the
[Martian Code Review Bench](https://github.com/withmartian/code-review-benchmark)
offline set, judges it with the benchmark's own step3 judge, and scores it the
way the dashboard does. LUM-988's Done-when bar is F1 ≥ 50% and F2 ≥ 60% on
the Core profile with the Opus 4.5 judge.

| File                                          | What it does                                                                                                                                                    |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prepare.ts`                                  | Per PR: the unified diff and the PR-head content of every changed (not removed) file, via `gh`.                                                                 |
| `replay.ts`                                   | Runs the shipped stage-A sequence per PR: over-cap check → `judgeDiffTier` → `packSecurityDiff` → `loadReviewContext` → `redactForInjection` → `judgeSecurity`. |
| `score.py`                                    | Injects each run as a pseudo-tool, judges it with step3 (Opus 4.5 via the AI Gateway), prints Core-profile P / R / F1 / F2 next to the leaderboard.             |
| `pr-key.ts`                                   | The one PR-url → directory-name function both TS scripts use.                                                                                                   |
| `results-sonnet55.json`, `score-sonnet55.txt` | The runs recorded on the LUM-988 PR (raw findings + scores).                                                                                                    |

Two differences from production, both deliberate: files come from the
`prepare.ts` snapshot instead of `readRepoFile` (same content: PR head), and
`priorityPaths` is empty (production ranks the hunt trigger's sites first,
which only changes anything when a diff is over its tier and gets trimmed).
Everything else — the budget tiers, the context packing rules, the redaction,
the prompt, the schema, the 15-finding cap, the model and its Anthropic-only
routing pin — is the production code, imported.

## Run

Needs a logged-in `gh`, `uv`, and `AI_GATEWAY_API_KEY` (in the environment
or `.env.local`; worktrees fall back to the main checkout's).

```bash
git clone https://github.com/withmartian/code-review-benchmark.git /tmp/crb   # tested at e616e84
(cd /tmp/crb/offline && uv sync)
npx tsx scripts/analysis/lum988-code-review-replay/prepare.ts --bench /tmp/crb/offline --out /tmp/lum988-data
DOTENV_CONFIG_PATH="$(git rev-parse --path-format=absolute --git-common-dir)/../.env.local" \
  npx tsx -r dotenv/config scripts/analysis/lum988-code-review-replay/replay.ts \
  --data /tmp/lum988-data --out /tmp/lum988-results.json
python3 scripts/analysis/lum988-code-review-replay/score.py \
  --bench /tmp/crb/offline --results /tmp/lum988-results.json --tool lumo988-sonnet55
```

Traps:

- **step3 is incremental per tool name.** A tool already present in its
  evaluations file is skipped, so a second replay under the same `--tool`
  scores the OLD judgement. Use a new name or delete `evals/<tool>.json`.
- Each pseudo-tool is judged into its own `evals/<tool>.json`
  (`--evaluations-file`), so several `score.py` runs can judge in parallel
  without racing on one `evaluations.json`.
- `score.py` edits the clone's `results/benchmark_data.json` and
  `results/anthropic_claude-opus-4.5/candidates.json` in place. Use a clone you
  do not mind changing.
- One benchmark label is known wrong: discourse PR #10's SQL injection is in
  the migration file, but the golden comment points at the controller (LUM-975).
  The scorer does not correct it.

## Result (2026-10-04)

Three replays of the shipped path, Opus 4.5 judge, Core profile (full table
with the leaderboard rows in `score-sonnet55.txt`):

| Run        | P         | R         | F1        | F2        | Security |
| ---------- | --------- | --------- | --------- | --------- | -------- |
| 1          | 39.9%     | 73.4%     | 51.7%     | 62.8%     | 8/11     |
| 2          | 39.0%     | 72.2%     | 50.7%     | 61.7%     | 6/11     |
| 3          | 40.4%     | 75.9%     | 52.7%     | 64.6%     | 8/11     |
| **pooled** | **39.8%** | **73.8%** | **51.7%** | **63.0%** |          |

For reference on the same 50 PRs: Qodo Extended 65.8 / 65.1, CodeRabbit
42.2 / 51.1 (F1 / F2). Latency median 17 s, max 42 s; prompt median ~91k chars.

Ablation, not shipped (`results-sonnet55-reworded.json`): with the schema's
`detail` / `findings` descriptions generalised away from LUM-975's
security-worded originals, 3 runs pooled to P 37.3 / R 74.1 / F1 49.6 / F2 61.9.
Recall is unchanged, but there are ~20 more false positives per run. So the
client keeps the measured wording; the system prompt defines the scope.
Run-to-run spread for one configuration is up to ~4.5 F1 points, so judge
a change on several runs, never on one.

## Agentic verifier (precision)

The single review call is tuned for recall; about 60% of what it reports is
not in the golden set. The verifier (`lib/llm/review-verifier-client.ts`)
gets what the review lacked, a read-only checkout of the PR head and the
hunt's allow-listed `run_shell`, and rejects a finding only when it can cite
the `path:line` that refutes it. Production applies its rejections only to
non-HIGH CORRECTNESS findings (`lib/security-scan/verifier.ts`).

| File                                                 | What it does                                                                                                                                                                                                      |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checkout.ts`                                        | A shallow clone per repo and a detached worktree per PR head (`pull/<n>/head`). ~15 GB for the 50 PRs.                                                                                                            |
| `verify.ts`                                          | Runs `verifyFindings` per PR over the findings a replay recorded, `run_shell` gated by `checkHuntCommand` and redacted as in production, against the local checkout.                                              |
| `score-verify.py`                                    | Scores a filtered run WITHOUT re-judging, from the step3 judgement of the unfiltered run (`matched_candidate` / `false_positives`). Reproduced the real judge exactly on 2 of 3 runs, off by one FP on the third. |
| `verify-v3-run{1,2,3}.json`, `score-verifier-v3.txt` | The shipped prompt's verdicts and the real-judge scores.                                                                                                                                                          |

```bash
npx tsx scripts/analysis/lum988-code-review-replay/checkout.ts --data /tmp/lum988-data --out /tmp/lum988-co
DOTENV_CONFIG_PATH=… npx tsx -r dotenv/config scripts/analysis/lum988-code-review-replay/verify.ts \
  --results results-sonnet55.json --run 0 --data /tmp/lum988-data --checkouts /tmp/lum988-co --out verify.json
python3 scripts/analysis/lum988-code-review-replay/score-verify.py \
  --bench /tmp/crb/offline --results results-sonnet55.json --run 0 --tool <judged tool> --verify verify.json
```

Result (real step3 judge on the filtered findings, 3 runs pooled):

|                                     | P         | R         | F1        | F2        |
| ----------------------------------- | --------- | --------- | --------- | --------- |
| No verifier                         | 39.8%     | 73.8%     | 51.7%     | 63.0%     |
| **Verifier v3, non-HIGH bugs only** | **45.9%** | **68.1%** | **54.9%** | **62.1%** |

What did not work (run 1, offline scoring): v1 without the diff (it rejected
"value changed from 30% to 50%" bugs it could not see); v2 applying every
rejection (F2 56.9); opus-5.5 as the verifier (F1 52.0, no better than
sonnet); consensus of two verifiers (F1 53.0). Verifier cost ~$0.12 per PR
mean, latency median 19 s / max 75 s, 0 defaulted verdicts out of 889.

Follow-up (production now sends the verifier only the rows it may reject,
`verify.ts --only-applicable`): offline scoring over the same 3 runs gives
pooled P 46.0 / R 68.4 / F1 55.0 / F2 62.3, against 46.0 / 68.1 / 54.9 / 62.2
when it saw every finding — no loss, fewer steps per scan.

## Precision, round 2 (2026-10-06)

The gap to the leaders is false positives, not recall: against Augment on the
same 50 PRs, 21 golden comments only Augment finds and 23 only Lumo finds,
but Lumo leaves ~127 false positives per run to Augment's ~70.

**Filters do not move the frontier.** Dropping every LOW, capping findings
per PR, keeping only findings two of three runs agree on, and a verifier that
also rejects "true but not worth a comment" (`verifier-prompt-v4.txt`: P 60.9
/ R 52.3 / F1 56.3 / F2 53.8; the narrowed `verifier-prompt-v5.txt`: F1 55.6 /
F2 60.9) all trade recall for precision along the same curve, F1 53–55. The
golden set counts small real bugs (carried-over code, defensive nil checks),
so "not worth a comment" removes ~1 true positive per 3–4 false ones.

**A listwise ranker does** (`rank.ts`, `lib/llm/review-ranker-client.ts`):
one tool-free call per PR after the verifier, seeing every finding it left
with its reason and the cited diff, gives each a probability p. At the same
number of findings dropped it beats the review's own order by 2–4 F1 points
(`score-rank.py` prints both). The threshold was chosen on run 1 and held out
on runs 2 and 3, with two ranker samples:

|                                      | P     | R     | F1    | F2    |
| ------------------------------------ | ----- | ----- | ----- | ----- |
| Verifier v3 (shipped)                | 46.0% | 68.1% | 54.9% | 62.2% |
| + ranker, p ≥ 18, sample 1 (offline) | 51.2% | 65.0% | 57.2% | 61.6% |
| + ranker, p ≥ 18, sample 2 (offline) | 50.8% | 64.6% | 56.9% | 61.2% |

Every run stays above F2 60 (lowest 60.6). Cost ~$0.025 per PR, ~5 s.

Real step3 judge on the sample-1 output (`results-rank18.json`,
`score-rank18.txt`): runs 57.9 / 62.4, 56.0 / 60.5, 57.7 / 62.0 (F1 / F2),
pooled **P 51.1 / R 65.0 / F1 57.2 / F2 61.6**, security 6–7 of 11 kept —
identical to the offline score.

```bash
DOTENV_CONFIG_PATH=… npx tsx -r dotenv/config scripts/analysis/lum988-code-review-replay/rank.ts \
  --results results-sonnet55.json --run 0 --verify verify-v3-run1.json --data /tmp/lum988-data --out rank-run1.json
python3 scripts/analysis/lum988-code-review-replay/score-rank.py --bench /tmp/crb/offline \
  --results results-sonnet55.json --runs 0:<judged tool>:verify-v3-run1.json:rank-run1.json
```

`verify.ts --system-file` swaps the verifier prompt for an ablation, and
`score-verify.py --applicable-only --drop all|refuted|minor` scores one under
the production policy (`minor` reads the v4/v5 reason prefix).
