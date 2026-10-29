# LUM-1286 duplicate-check eval

Replays the `lumo task create` duplicate gate on public GitHub duplicates. A pair is an issue closed as a duplicate (`ClosedEvent.duplicateOf`) and the canonical issue it points to. The new issue's title is the input; the canonical is the expected match. Negatives are issues never closed or labelled as a duplicate. Those are an upper bound on false blocks: some of them really are unlabelled duplicates.

## Data

7 repos, fetched with `fetch.py`, 1,555 duplicate pairs (Meta tracker issues excluded):

| Repo                      | Window            | Issues | Pairs |
| ------------------------- | ----------------- | ------ | ----- |
| microsoft/vscode          | 2026-03 → 04      | 9,763  | 444   |
| golang/go                 | 2025-11 → 2026-04 | 2,549  | 289   |
| flutter/flutter           | 2025-11 → 2026-04 | 2,999  | 312   |
| home-assistant/core       | 2025-11 → 2026-04 | 5,401  | 182   |
| rust-lang/rust            | 2025-11 → 2026-04 | 2,214  | 121   |
| 1Panel-dev/1Panel (zh/en) | 2025-05 → 2026-04 | 2,013  | 131   |
| siyuan-note/siyuan (zh)   | 2025-05 → 2026-04 | 2,357  | 76    |

`probe_repos.py` checks a repo's yield before you fetch it. TypeScript, kubernetes and react close almost nothing as a duplicate, so they yield no pairs.

## Scripts

| Script                                            | What it does                                                                                                                |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `fetch.py <out> <start> <end>` (env `REPO`)       | issues + duplicate pairs via `gh api graphql`                                                                               |
| `eval.ts <dir> prefilter`                         | bigram top-k rank of the canonical (no LLM)                                                                                 |
| `eval.ts <dir> gate [--recall bigram\|embedding]` | the shipped `checkDuplicates` (prompt, timeout, 0.7 suggest score). It swaps only the repository reads for the case's pool. |
| `embed.ts <dir>`                                  | embeds every title with the production model (`EMBEDDING_MODEL`)                                                            |
| `embed_analyze.py <root>`                         | offline embedding recall and cosine-only gate, vs bigram                                                                    |
| `report.py <root>`                                | per-repo tables from the `gate` runs                                                                                        |

Run the gate at `--concurrency 2` or lower. At 6, the gateway returned empty objects (`AI_NoObjectGeneratedError`) for 69% of calls.

## Results

### Step 1 (bigram top-20 over the 200 most recent tasks + LLM)

60 positives and 60 negatives per repo (150 + 150 for vscode):

- End-to-end the gate caught **43%** of duplicates (510 pairs).
- When the canonical was among the candidates and the call succeeded, the model caught **80%**.
- **40%** of the non-errored negatives were blocked.
- **17%** of calls errored (timeouts and empty objects) and failed open.
- The block-score threshold does not separate positives from negatives. Raising it from 0.7 to 0.9 drops caught from 43% to 35% and negatives blocked from 40% to 25%.

Recall was the main loss. The bigram top-20 held the canonical for **69%** of pairs, and for only **42%** of CJK titles.

### Embedding recall (offline, same pools)

Top-20 recall of the canonical, with the same 200-issue pool as step 1:

|                  | bigram | embedding |
| ---------------- | ------ | --------- |
| all 1,555 pairs  | 69%    | 79%       |
| CJK titles (130) | 42%    | 87%       |
| 1Panel (zh/en)   | 53%    | 91%       |
| siyuan (zh)      | 43%    | 84%       |

Taking the bigram top-20 and the embedding top-20 together (40 candidates) reaches 84%.

A cosine threshold alone is a worse gate than the LLM. At a similar share of negatives blocked (36%), cosine caught 35% and the LLM caught 43%. Skipping the LLM below a cosine floor saves little: at a floor of 0.65, only 7% of calls are skipped and 2% of duplicates are lost.

That is why step 2 keeps the LLM judge and replaces only the candidate recall. Candidates are now the project's top-10 tasks by title embedding, of any age, plus the top-3 bigram hits among the recent tasks (bigram top-20 when embeddings are unavailable).

### Step 2 end-to-end

`gate --recall embedding`, 30 positives and 30 negatives per repo on vscode, go and 1Panel, at concurrency 2. Every case was also run with step 1 (bigram) and compared with `compare.py`. The embedding run searches every earlier issue; the bigram run is limited to the recent 200.

**Candidate count matters.** With 20 embedding candidates plus 5 bigram, the same cases took 10–20s longer, and 47% of vscode calls timed out. At 10 + 3, latency is back near step 1 (p50 30s vs 26s on vscode).

Paired results, 90 positives and 62 negatives where neither call errored:

| block score | caught: bigram | caught: embedding | negatives blocked: bigram | negatives blocked: embedding |
| ----------- | -------------- | ----------------- | ------------------------- | ---------------------------- |
| 0.70        | 32             | 36                | 20                        | 35                           |
| 0.85        | 28             | 33                | 16                        | 26                           |
| 0.90        | 20             | 30                | 12                        | 22                           |

The bigram column is optimistic. The eval swapped the canonical into the recent-200 pool, but it was really there for only 35 of the 90 pairs (pool ordered by creation time). Counting the other 55 as misses, bigram would have caught **11/90**.

Production orders the pool by `updatedAt`, so canonicals with recent activity are more often inside it. The true step-1 figure lies between 11 and 32.

At equal false blocks (block score 0.9 vs 0.7 for bigram), embedding recall catches 30, against 11–32 for bigram. At 0.7 it catches more (36), but blocks 56% of negatives instead of 32%: the judge rates "related" candidates as duplicates, and embedding recall surfaces more of them. The remaining bottleneck is the judge's precision, not recall.

**Shipped:** embedding top-10 + bigram top-3, block score kept at **0.7** (LUM-1286 Decisions, 2026-10-22). The gate only asks for confirmation, so it trades extra prompts for more duplicates caught.
