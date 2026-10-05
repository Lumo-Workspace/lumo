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
