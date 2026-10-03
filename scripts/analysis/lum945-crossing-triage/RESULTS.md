# LUM-945 results (2026-10-03)

Corpus: 372 human-dispositioned production crossings (404 rows; AUTO\_\* and
TEST_TAMPERING excluded). Every model is scored on the 366 Lumo-team items all
models judged (Jev only receives Lumo-team data — no ZDR endpoint).
`moonshotai/kimi-k2-thinking` was stopped at ~50/372: 45–76 s per item made a
full run impractical, so it is not in the tables.

## Auto-clear scope — PROJECT_RULE_VIOLATION, SPINOFF_LAUNDERED, NEW_NPM_DEPENDENCY, TEST_FILE_DELETED (non-evasion)

32 CONFIRMED · 227 FALSE_POSITIVE. "leaked" = CONFIRMED judged legit at ≥ threshold.

| model                      | 0.5                   | 0.6        | 0.7        | 0.8      | 0.9      | 0.95       |
| -------------------------- | --------------------- | ---------- | ---------- | -------- | -------- | ---------- |
| typesafe-ai/jev (boolean)  | 3 leaked · 89 cleared | **0 · 56** | 0 · 20     | 0 · 5    | 0 · 1    | 0 · 0      |
| typesafe-ai/jev (choice)   | 3 · 77                | 1 · 62     | **0 · 38** | 0 · 22   | 0 · 9    | 0 · 3      |
| anthropic/claude-haiku-4.5 | 17 · 184              | 17 · 184   | 17 · 184   | 17 · 182 | 11 · 145 | **0 · 36** |
| deepseek/deepseek-v4-flash | 4 · 110               | 4 · 110    | 4 · 102    | 2 · 77   | 2 · 61   | 1 · 24     |
| alibaba/qwen3.7-flash      | 5 · 67                | 5 · 67     | 5 · 67     | 5 · 67   | 5 · 67   | 5 · 54     |

The highest score any CONFIRMED item got sits 0.01 (Jev boolean, 0.59) to 0.03
(Jev choice, 0.67) below the first zero-leak threshold. With an equal ~0.05
margin the two Jev variants clear about the same (33 vs 38).

## Reliability & cost (366 calls each)

| model                      | failures           | p50    | p95    | cost   |
| -------------------------- | ------------------ | ------ | ------ | ------ |
| typesafe-ai/jev (choice)   | 0                  | 280 ms | 489 ms | $0.024 |
| typesafe-ai/jev (boolean)  | 0                  | 295 ms | 535 ms | $0.024 |
| anthropic/claude-haiku-4.5 | 0                  | 1.8 s  | 2.4 s  | $0.74  |
| deepseek/deepseek-v4-flash | 9 (empty response) | 3.6 s  | 26.9 s | $0.14  |
| alibaba/qwen3.7-flash      | 0                  | 13.1 s | 21.6 s | $0.07  |

## Findings

1. Only Jev and Haiku reach zero leaks; at that point they clear 16–25 % of the
   false positives. Jev is ~6× faster and ~1/30 the cost.
2. The LLMs share one failure mode: "the task needs X" read as licence to break
   a how-to rule (migrate dev for a migration task, a direct SDK import for a
   scanning task), and occasionally an agent statement used as evidence. At 0.9
   Haiku called all 6 CONFIRMED HARDCODED_SECRET rows legit — the
   human-only rule for irreversible classes is necessary.
3. Some CONFIRMED labels mean "it happened" rather than "it was wrong" (e.g. a
   dependency the user approved), which caps any judge's measured precision.
4. SPINOFF_LAUNDERED (like TEST_TAMPERING) lost its producer in LUM-942; it
   is scored here only as history. No variant cleared any of its rows, so the
   tables are unaffected, but a live auto-clear scope has three categories.
5. Qwen's confidence is saturated (≥0.9 almost always), so thresholding cannot
   separate its errors. Deepseek still leaks at 0.95.
