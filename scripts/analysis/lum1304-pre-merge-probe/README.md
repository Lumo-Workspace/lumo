# LUM-1304 — pre-merge checks replay on real prompts

The pre-merge checks (`ee/security/llm/pre-merge-checks-client.ts`) are one
`generateObject` call on `MEMORY_JUDGE_MODEL` (DeepSeek V4-Pro) with a 60 s
budget. From 2026-10-22 22:08 UTC production returned "Lumo could not run this
check this time" on most scans: 2 × `No object generated: the model did not
return a response`, then 15 × `Delay was aborted` (the 60 s timeout).

## What was measured

Under ZDR the gateway serves DeepSeek V4-Pro from several hosts, and they
behave very differently with a JSON schema (`results.json`, concurrency 1):

| Host      | Structured outputs (catalog) | Result on the real #1681 prompt                                                                                                             |
| --------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| baseten   | no                           | 0/3 — content empty, all output is reasoning (~4 s)                                                                                         |
| alibaba   | yes                          | valid; 52–77 s over 6 untimed runs (default routing, all served by alibaba; 56 s with `--only alibaba`), 2–3k reasoning tokens at ~40 tok/s |
| azure     | yes                          | 7/7 valid, 3–11 s, no reasoning                                                                                                             |
| deepinfra | yes                          | 4/4 valid, 5–7 s, no reasoning                                                                                                              |

So the outage is gateway routing, not our request: on baseten the schema is
ignored (empty answer), on alibaba it is answered past our budget. The fix
routes structured calls on this model to `azure → deepinfra → alibaba`
(`STRUCTURED_OUTPUT_HOSTS` in `lib/ai/models.ts`; all announced
subprocessors), adds an envelope repair (`pre-merge-checks-repair.ts`) and one
retry inside the same deadline for an answer that could not become an object.

After: `shipped` 10/10 on #1681 (p50 3.5 s, max 4.5 s) and 10/10 on #1685
(40k-char diff, p50 6.1 s, max 11.6 s).

## Re-run

```bash
# 1. Capture the model input the shipped service builds (no DB, no writes;
#    PR from gh, linked task from `lumo task show --json`). Not committed.
npx tsx scripts/analysis/lum1304-pre-merge-probe/capture.ts \
  --repo Lumo-Workspace/lumo --pr 1681 --task LUM-702 --out /abs/scratch/pr1681.json

# 2. Replay it (needs AI_GATEWAY_API_KEY). Keep it sequential: the gateway
#    returns empties under concurrency.
DOTENV_CONFIG_PATH=/abs/main-checkout/.env.local \
  npx tsx -r dotenv/config scripts/analysis/lum1304-pre-merge-probe/probe.ts \
  --input /abs/scratch/pr1681.json --variant shipped --n 10
```

`--variant object|text --only <host,…>` measures one host without the shipped
routing. Output is one JSON line per call (latency, finish reason, tokens,
serving host, verdict ids) — never prompt text.

## Other callers on the same model

Every other `generateObject` call on `MEMORY_JUDGE_MODEL` / `GENERATION_MODEL`
spreads `structuredOutputCallOptions(model)` (guarded by
`__tests__/lib/ai/structured-output-callers.test.ts`). `probe-callers.ts`
replays two of them through their shipped code: `summarizeWholePr` on #1685
went 5/5 (p50 4.3 s), and `computeProjectFoldProposals` over 40 real team
cards went 3/3 non-degraded with proposals (p50 15 s for the whole
pipeline). Production had logged `[memory.fold] clustering … No object
generated` and `[pr-whole-summary] … Delay was aborted` for these two.

```bash
DOTENV_CONFIG_PATH=/abs/main-checkout/.env.local \
  npx tsx -r dotenv/config scripts/analysis/lum1304-pre-merge-probe/probe-callers.ts \
  --caller fold|summary --n 3
```
