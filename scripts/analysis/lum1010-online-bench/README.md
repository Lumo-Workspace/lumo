# LUM-1010 — held-out check of the AI review on fresh bot-reviewed PRs

LUM-988 tuned the PR scan's AI review (review → agentic verifier → listwise
ranker, `RANKER_KEEP_THRESHOLD=18`) on the 50 PRs of the Martian Code Review
Bench **offline** set. Every threshold was picked on those 50 PRs, so this
replays the shipped pipeline, unchanged, on recent public PRs it has never
seen, using the same benchmark's **online** pipeline
(`github.com/withmartian/code-review-benchmark`, `online/etl`, tested at e616e84).

## How the online benchmark scores

Ground truth is not a curated list: for a merged PR that a review bot
reviewed, an LLM reads the commits pushed **after** the bot's review and lists
what the developer fixed ("human actions", ETL step 2). A reviewer's
suggestion is a true positive when the step-3 judge matches it to one of
those fixes.

- precision = matched suggestions / suggestions
- recall = matched human actions / human actions (PRs without post-review
  fixes add suggestions but no actions)

Known bias, keep it in mind when reading the numbers: a real issue nobody fixed
counts as a false positive, so precision is understated for everyone; and the
reviewing bot gets credit for fixes its own comments caused, while Lumo — which
was never on the PR — only matches fixes it independently predicts. The
online numbers are for **relative** comparison on the same PRs, not an absolute
bar like the offline F1 ≥ 50 / F2 ≥ 60.

## Pipeline

| Step | Script                                                                             | What it does                                                                                                                                                                                                                                                                                                                                                                                             |
| ---- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `discover.py`                                                                      | One GitHub Search query per (bot, day): `reviewed-by:<bot>[bot] is:merged merged:<day>`, random sample, ≤ `--per-repo` PRs per repository across all bots, each PR assigned to one bot. Writes into the ETL's SQLite DB. (The ETL's own `discover` bisects each day down to the 1,000-result cap — hundreds of rate-limited queries per day for the most-installed bots — far more than a sample needs.) |
| 2    | ETL `enrich`, `analyze`                                                            | Commits, reviews, threads, per-commit diffs (skips > 2,000 changed lines); then the 3 LLM steps for the reviewing bot.                                                                                                                                                                                                                                                                                   |
| 3    | `prepare.py`                                                                       | Per analysed PR: the commit the bot reviewed (the ETL's `_find_bot_review_commit`, "hash X"), `base...hashX` diff, changed files at hash X, and a detached checkout at hash X for the verifier. LUM-988 replay layout.                                                                                                                                                                                   |
| 4    | `../lum988-code-review-replay/replay.ts`, `verify.ts --only-applicable`, `rank.ts` | The shipped review, verifier and ranker, unchanged.                                                                                                                                                                                                                                                                                                                                                      |
| 5    | `judge.py`                                                                         | Applies the production removal policy, feeds Lumo's remaining findings to the ETL's step-3 prompt against the same human actions.                                                                                                                                                                                                                                                                        |
| 6    | `score.py`                                                                         | Pooled P / R / F1 / F2, overall and per reviewing bot.                                                                                                                                                                                                                                                                                                                                                   |

Reviewing hash X, not the merged head, matters: the post-review commits are
where the answers are.

## Run

Needs `uv`, a logged-in `gh`, `git`, and `AI_GATEWAY_API_KEY` in `.env.local`.

```bash
S=<scratch dir>; W=<repo>/scripts/analysis
git clone https://github.com/withmartian/code-review-benchmark.git $S/crb
cd $S/crb/online/etl && uv sync
```

**Patch the ETL's LLM client to force zero data retention** (team rule: every
eval LLM call goes through the ZDR gateway). In `llm/client.py`, add to the
`parse(...)` call:

```python
extra_body={"providerOptions": {"gateway": {"zeroDataRetention": True}}},
```

Checked: with it, `anthropic/claude-fable-5.1` (not ZDR-eligible) is refused
with `no_zdr_providers_available`, `anthropic/claude-opus-4.5` answers.

```bash
export DATABASE_URL=sqlite:///$S/pr_review.db GITHUB_TOKEN=$(gh auth token)
export MARTIAN_BASE_URL=https://ai-gateway.vercel.sh/v1 MARTIAN_MODEL_NAME=anthropic/claude-opus-4.5
export MARTIAN_API_KEY=<AI_GATEWAY_API_KEY>
uv run python $W/lum1010-online-bench/discover.py \
  --bots '<bot-a>[bot],augmentcode[bot],greptile-apps[bot],cursor[bot]' \
  --start 2026-09-22 --end 2026-09-28 --per-day 3
uv run python main.py enrich --all --one-shot
uv run python main.py analyze --all --limit 1000
uv run python $W/lum1010-online-bench/prepare.py --out $S/data --checkouts $S/co
```

Then, from the repo root, the LUM-988 scripts (`replay.ts --runs 2`,
`verify.ts --only-applicable --run <i>`, `rank.ts --run <i>`) with
`--data $S/data --checkouts $S/co`, and per run:

```bash
cd $S/crb/online/etl
uv run python $W/lum1010-online-bench/judge.py --data $S/data --review review.json --run 0 \
  --verify verify-run0.json --rank rank-run0.json --tag lumo-run0 --out $S/judged.json
python3 $W/lum1010-online-bench/score.py $S/judged.json
```

Traps:

- The Search API needs the full app login, `<app>[bot]`; without the
  suffix it returns 0 results. Copilot maps to
  `copilot-pull-request-reviewer[bot]` (`SEARCH_API_USERNAME_MAP`).
- aiosqlite leaves the last implicit transaction open: commit before
  `close()` or the last bot's inserts vanish.
- Repos with Git LFS: checkouts run with the LFS filters off (pointer files
  stay), otherwise `worktree add` fails without `git-lfs`.
- Some PRs exceed the judge's 200k-token context in ETL step 1/2 and are
  dropped by the ETL with an LLM 400.
- `judge.py` caches per `--tag` and records the inputs it was judged with
  (review file, run, verify/rank files, threshold); re-using a tag with other
  inputs is refused — pick a new tag. A failed judge call leaves that PR
  unjudged; re-run the same command to fill it in.
- Crawled data, diffs and checkouts stay in the scratch dir — never commit
  them (big JSON in a PR fails Lumo's own PR scan).

## Result — pilot (2026-10-06)

76 PRs merged 2026-09-22..28, one per repository: Bot A 21, Greptile 19,
Augment 18, Cursor Bugbot 18 (84 discovered; 7 skipped by the ETL for > 2,000
changed lines, 1 dropped by step 1/2 at > 200k tokens). 34 PRs had post-review
fixes, 227 human actions in all. Judge `anthropic/claude-opus-4.5` via the ZDR
gateway; Lumo = the shipped review, 2 runs; 3 PRs over the review's diff cap
(no findings, as in production). `score.py` output, pooled:

|                                     | P     | R     | F1   | F2   |
| ----------------------------------- | ----- | ----- | ---- | ---- |
| reviewing bot (each PR's own)       | 59.8% | 29.5% | 39.5 | 32.8 |
| Lumo raw review, run 1              | 23.6% | 21.1% | 22.3 | 21.6 |
| Lumo raw review, run 2              | 27.3% | 23.8% | 25.4 | 24.4 |
| Lumo shipped (+verifier +ranker), 1 | 32.7% | 15.4% | 21.0 | 17.2 |
| Lumo shipped (+verifier +ranker), 2 | 32.8% | 16.7% | 22.2 | 18.6 |

Per bot, shipped Lumo vs the bot (F1): Augment 31–33 vs 53, Bot A 26–28
vs 35, Greptile 17–23 vs 40, Cursor 12 vs 39.

**The headline gap is mostly the causal bias above.** Split by where a fix
came from:

|                 | fixes the bot pointed at (67) | all other fixes (160) |
| --------------- | ----------------------------- | --------------------- |
| Lumo raw review | 29 / 32 (43–48%)              | 19 / 22 (12–14%)      |
| Lumo shipped    | 26 / 26 (39%)                 | 9 / 12 (6–8%)         |

The 67 are issues a developer confirmed real by fixing them; Lumo's raw
review finds ~45% of what each bot found and got fixed. The other 160 are fixes
prompted by human reviewers or the author's own follow-ups, many of them not
findable from the diff (docs wording, new requirements).

What the pilot says about LUM-988:

- **The precision stack does not carry over.** Offline it gave +5 F1 for −1 F2;
  here verifier + ranker halve the findings, precision +6–9 points, recall −6
  to −7, F1 −1 to −3, F2 −4 to −6. On the cleanest signal (fixes a bot pointed
  at) it drops 3–6 of ~30 confirmed-real catches. Small sample (34 PRs with
  fixes), but both runs agree.
- Caveat on precision: an unfixed real issue counts as a false positive here,
  so a filter that removes real-but-unfixed findings looks like a precision
  gain. The recall loss is the trustworthy part.

Data quality: the sample is dominated by small projects — median repository
1 star, 16 of 76 with ≥ 100 stars — many of them agent-driven. The full run
should filter on repository size / human engagement before scaling.

Cost: Lumo side ~6.9M input tokens over the verifier, ranker and review
(2 runs); the ETL analysis ran 3 Opus 4.5 calls per PR. Roughly $50–70 for
the pilot all told (estimated from token counts, not billed figures).

## Why the ranker does not transfer (2026-10-06)

`ablate.py` re-scores the pilot's raw runs without re-judging (it reproduces
the real judge on the shipped variant: run 1 exactly, run 2 within 1 point);
`ranker-diagnosis.py` puts the pilot and the LUM-988 offline runs side by side
with the same counting (its offline rows reproduce the published LUM-988
numbers exactly).

| Ranker AUC, TP vs FP by p | online | offline |
| ------------------------- | ------ | ------- |
| all findings              | 0.52   | 0.76    |
| logic_error               | 0.62   | 0.77    |
| test_defect, doc_mismatch | 0.37   | 0.84    |
| everything else           | 0.54   | 0.73    |

The verifier transfers: it rejects 13% of true and 36% of false positives
online, 11% / 32% offline. The ranker does not, for two reasons that add up:

1. **A prior that fits the Martian labels, not developers.** The ranker
   prompt lowers p for "test tidiness" (`lib/llm/review-ranker-client.ts`), and
   on the offline set that is right — the golden comments almost never count a
   missing test, so test/doc findings there are mostly false positives
   (AUC 0.84). On fresh PRs developers do add the missing test, pin the action
   tag, fix the stale comment: test/doc findings are fixed as often as logic
   errors (28% vs 26%), and the ranker's order within them is inverted
   (AUC 0.37). Test/doc is also 30% of the ranked findings online vs 12%
   offline, so the mistake costs more.
2. **Weaker discrimination even on logic errors** (0.77 → 0.62), part of which
   is label noise — an unfixed real bug is a "false positive" online.

Effect, pooled (online 2 runs / offline 3 runs):

| Variant                                  | online F1 / F2 | offline F1 / F2 |
| ---------------------------------------- | -------------- | --------------- |
| raw review                               | 23.9 / 23.0    | 51.7 / 63.0     |
| verifier                                 | 24.7 / 21.8    | 54.9 / 62.2     |
| verifier + ranker p ≥ 18 (shipped)       | 21.1 / 17.4    | 57.2 / 61.6     |
| verifier + ranker, ranker skips test/doc | 24.4 / 21.0    | 55.6 / 61.2     |

About 1.6 of the ranker's +2.3 offline F1 came from dropping test/doc
findings — a benchmark-specific gain. Without it the ranker adds ~+0.7
offline and ~−0.3 online over the verifier alone: nothing measurable.

Caveat: 34 PRs with fixes, mostly small repositories; the test/doc result
rests on 85 findings. The direction is consistent across both runs and every
subset checked (repository size, diff under the ranker's 80k cap, severity).
