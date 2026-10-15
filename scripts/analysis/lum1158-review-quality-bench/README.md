# LUM-1158 — review quality benchmark against the industry reference

A repeatable head-to-head of Lumo's shipped AI review and the industry-reference
review bot on the **same** merged PRs. The reference is anonymised as `bot-a`
everywhere in this repository; its real login is passed only at run time in
`BENCH_REFERENCE_LOGIN` (the full app login, `<app>[bot]`) and never written to
a file. The named comparison lives only in the internal Lumo doc.

Builds on LUM-1010 (`../lum1010-online-bench/`), with three changes:

- **A fixed, committed dataset** (`manifest.json`): PR url + the exact commits
  (base, the commit the reviewer of record first reviewed = "hash X", head at
  merge), so every re-run scores the same code. Drawn with a seed.
- **Better-quality sample**: repositories with ≥ 100 stars and an OSI-permissive
  license (the LUM-1010 pilot was dominated by 1-star agent repos), human
  authors, ≤ 2,000 changed lines, one PR per repository, bot-a left ≥ 1 inline
  comment on hash X, and ≥ 1 non-merge commit after it (ground truth).
- **Self-contained, no external ETL**: our own prompts (`prompts.ts`), every
  call through the ZDR gateway (`lib/ai/gateway`), one judge model for both
  reviewers, and **per-PR noise** (findings the developers did not act on).

Also `own` rows: Lumo's own merged PRs that Lumo reviewed. bot-a never reviewed
them, so they are scored for Lumo only (absolute numbers on our code; they are
biased in Lumo's favour — its real review prompted some of those fixes).

## Scoring

Ground truth = the fixes developers made in the commits after hash X (an LLM
lists them from those commits' messages and diffs, `truth` step). bot-a's
review of hash X (its top-level inline comments and review bodies on that
commit — replies and later rounds are excluded, so it is scored on the code
Lumo saw) is split into discrete issues (`reference` step). Lumo's findings
are the replayed shipped pipeline (review → verifier → ranker, production
removal policy). One judge prompt pairs each reviewer's findings with fixes.

- precision = matched findings / findings; recall = matched fixes / fixes;
  F1, F2; **noise/PR** = mean unmatched findings per PR; findings/PR.
- **Recall by source of the fix**: bot-a gets causal credit for fixes its own
  comments prompted — Lumo, never on the PR, cannot. The report splits Lumo's
  recall into "fixes bot-a pointed at" (developer-confirmed real issues bot-a
  caught: how much of that Lumo catches independently) and "other fixes"
  (bot-a gets 0 there by construction; a fair independent signal).
- Known bias: a real issue nobody fixed counts as a false positive, for both.
  Read the numbers as relative, on the same PRs, not as an absolute bar.

## Run

Needs a logged-in `gh`, `git`, and `AI_GATEWAY_API_KEY` in the main checkout's
`.env.local`. Data and checkouts go to a scratch dir — **never commit them**
(PR content of third-party repos; big JSON also fails Lumo's own PR scan).

```bash
R=$(git rev-parse --path-format=absolute --git-common-dir)/..   # main checkout
B=scripts/analysis/lum1158-review-quality-bench
L=scripts/analysis/lum988-code-review-replay
S=<scratch dir>
export BENCH_REFERENCE_LOGIN='<app>[bot]'
ENV="DOTENV_CONFIG_PATH=$R/.env.local"

# 0. (only to re-draw the dataset) — free, GitHub API only
npx tsx $B/discover.ts --start 2026-09-01 --end 2026-10-10 --oss 40 --own 10 \
  --own-start 2026-09-15 --own-end 2026-10-14

# 1. fetch diffs, files, post-review commits, bot-a's review (free)
npx tsx $B/collect.ts --data $S/data --checkouts $S/co [--ids oss-01,oss-02]

# 2. Lumo's shipped pipeline, unchanged (paid: review model)
env $ENV npx tsx -r dotenv/config $L/replay.ts --data $S/data --out $S/review.json --runs 2
for i in 0 1; do
  env $ENV npx tsx -r dotenv/config $L/verify.ts --results $S/review.json --run $i \
    --data $S/data --checkouts $S/co --out $S/verify-run$i.json --only-applicable
  env $ENV npx tsx -r dotenv/config $L/rank.ts --results $S/review.json --run $i \
    --verify $S/verify-run$i.json --data $S/data --out $S/rank-run$i.json
done

# 3. labels (truth + bot-a issues) and judging (paid: judge model)
env $ENV npx tsx -r dotenv/config $B/label.ts --data $S/data
env $ENV npx tsx -r dotenv/config $B/judge.ts --data $S/data --tag bot-a --reference
for i in 0 1; do
  env $ENV npx tsx -r dotenv/config $B/judge.ts --data $S/data --tag lumo-run$i \
    --review $S/review.json --run $i --verify $S/verify-run$i.json --rank $S/rank-run$i.json
done
# optional: the raw review (no verifier/ranker) as its own tag
env $ENV npx tsx -r dotenv/config $B/judge.ts --data $S/data --tag lumo-raw-run0 \
  --review $S/review.json --run 0

# 4. report
npx tsx $B/score.ts --data $S/data --tags lumo-run0,lumo-run1 --out $S/report.md

# 5. two arms, several runs each: is the difference bigger than run noise? (free)
npx tsx $B/compare.ts --data $S/data --base lumo-run0,lumo-run1,lumo-run2 \
  --variant v-run0,v-run1,v-run2 [--fixes oss-03:A4,own-05:A2] --out $S/compare.md
```

Every step caches and re-running fills in only what is missing; `judge.ts`
refuses to re-use a tag with different inputs. Typecheck the scripts (the root
tsconfig excludes `scripts/`): `npx tsc --noEmit -p $B/tsconfig.check.json`.

Traps:

- The Search API needs the full app login with `[bot]`; without it, 0 results.
- `replay.ts` skips a diff over the review's largest tier; production now
  reviews part of such a PR (LUM-1144). The dataset caps PRs at 2,000 changed
  lines, so this does not arise in practice — check `review.json` for
  `over-cap` rows before reading a result.
- Repos with Git LFS: checkouts run with the LFS filters off.
- `manifest.json` may hold only `bot-a`/`lumo` as reviewer labels; the unit
  test fails on any `[bot]` login in it.

## Dataset (manifest.json, drawn 2026-10-15)

40 `oss` PRs merged 2026-09-01..10-10 (40 repositories, median 906 stars,
MIT/Apache-2.0/BSD-3-Clause/MPL-2.0) and 10 `own` PRs merged
2026-09-15..10-14; median 241 changed lines, 21,172 in all.

## Smoke run (2026-10-15)

3 PRs (`oss-04`, `oss-06`, `own-08`), one Lumo run, every step end to end:
collect → replay → verify → rank → label → judge (bot-a, shipped, raw) →
score. ~2 minutes; label + judge 17.6k in / 6.3k out tokens, review +
verifier + ranker ~0.2M in. Too small to read anything into the numbers; it
checks the plumbing. The full run's numbers go in the Lumo doc, not here.

## Full run (2026-10-15)

All 50 PRs, Lumo replayed twice (shipped and raw), about $19. Pooled over the
40 `oss` PRs: bot-a F1 63.6; Lumo shipped F1 43.0 / 35.5; Lumo raw F1 39.9 /
32.4. Of the fixes bot-a pointed at, Lumo found 42–47% on its own. The full
write-up, gaps and named comparison are in the internal Lumo doc bound to
LUM-1158.

## Measuring a change (LUM-1197)

Lumo's review is sampled, and the noise cannot be switched off: the review
model (`anthropic/claude-sonnet-5.5`, through the gateway) ignores
`temperature`, `topK` and `topP` — the request carries them, no warning comes
back, and three calls at temperature 0 still answer differently (checked
2026-10-16, with and without thinking; the same probe on Sonnet 4.5
answered identically twice). There is no seed. So every comparison has to average the
noise out, and has to say how much is left.

What the noise is (shipped pipeline; 40 `oss` PRs × 2 runs plus a seeded
20-PR subset × 4 runs, `--seed 1197`: `oss-06,10,12,13,14,15,16,24,26,27,28,32,34,35`,
`own-01,02,03,06,07,10`):

- one run's pooled F1 has an SD of about **3.7** on the 40 `oss` PRs and
  **4.8** on the 10 `own` PRs; on a random 20-PR `oss` subset 5.2, on 10 PRs
  7.1. Precision moves more than recall (SD 5.2 vs 3.3 on `oss`): how many
  unmatched findings a sample produces is the bigger half;
- it comes from the review sample: the raw review (no verifier/ranker) is
  about as noisy as the shipped pipeline (run SD 3.1 vs 3.8 on `oss`);
- the judge adds none worth measuring: re-judging one run's 20 PRs gave the
  same matches, so judge each run once;
- most fixes are found always or never — over 4 runs on the subset, 18 of 35
  `oss` fixes were never found and 8 always; only 9 moved.

The smallest arm-mean F1 difference a comparison detects reliably
(95% two-sided, 80% power; `detectableDelta`):

| runs per arm | 40 `oss` PRs | 10 `own` PRs |
| ------------ | ------------ | ------------ |
| 2            | 10.3         | 13.4         |
| 3            | 8.4          | 10.9         |
| 4            | 7.3          | 9.5          |
| 8            | 5.1          | 6.7          |
| 12           | 4.2          | 5.5          |

A +2 F1 effect would need about 50 runs per arm on these PRs. So pooled F1
is a guard, not the test, for a small prompt change:

1. **Pre-register the target fixes** — the `prId:fixId`s the change is meant
   to catch (from the gaps list), before running. The test is their hit count
   over runs, `compare.ts --fixes`: one fix going from 0/4 to 3/3 is
   p = 0.029. Fixes that never move cannot make noise.
2. **Guard on everything else**: at least 3 runs per arm on both slices;
   reject a change whose F1 interval (`compare.ts`) lies wholly below 0, and
   look at noise/PR per run next to it. Read "inside run noise" as no
   evidence either way, never as a gain.
3. **Reuse the baseline runs** while the shipped review prompt, model and
   pipeline are unchanged (`git log` the prompt files): 4 shipped runs exist
   on the subset and 2 on every PR. Otherwise run a fresh same-day baseline.
4. **Verifier, ranker or removal-policy changes** reuse the same review
   samples in both arms (re-run only `verify.ts` / `rank.ts`): the review
   noise then cancels exactly.
5. **Compare like with like**: "found by every run" falls as runs are added,
   so compare it only between arms with the same number of runs.

Cost per PR per run (subset, 2026-10-16 list prices): review ≈ $0.10,
verifier ≈ $0.07, ranker ≈ $0.01, judge ≈ $0.01 — a shipped run of all 50 PRs
is about $9.5; a raw-only run (review + judge) about $5.5.
