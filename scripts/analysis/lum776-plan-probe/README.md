# LUM-776 — planner A/B probe on real prompts

The L3 planning step (`lib/llm/security-hunt-plan-client.ts`) is a
`generateObject` call on the FAST bucket. Its failure rate depends on the real
richness of the prompt (LUM-766: a slim synthetic prompt reported ~50 % success
where real ones scored 0/16), and the same prompt repeated is one sample, not
many. So the model/schema/budget choice for this call ships on **≥ 16 distinct
real prompts**, rebuilt from production scans, and the committed `results.json`
is what `__tests__/probe-results.test.ts` holds the shipped configuration to.

## Re-run

1. Rebuild the corpus (read-only against production; the file is local and
   NOT committed — the prompts carry acceptance criteria and team memory):

   ```bash
   DOTENV_CONFIG_PATH=/abs/path/to/main-checkout/.env.production \
     npx tsx -r dotenv/config scripts/analysis/lum776-plan-probe/build-corpus.ts \
     --out /abs/scratch/corpus.json --take 24
   ```

   Each entry is a distinct (PR, head sha) whose scan really ran the planner
   (`huntAudit.plannedBy` ∈ {model, fallback}); the diff comes from GitHub via
   `gh`, the trigger reasons / touched paths are recomputed with the shipped
   `evaluateHuntTrigger`, findings and task context are read from production.

2. Run the variants (needs `AI_GATEWAY_API_KEY`):

   ```bash
   DOTENV_CONFIG_PATH=/abs/path/to/main-checkout/.env.local \
     npx tsx -r dotenv/config scripts/analysis/lum776-plan-probe/probe.ts \
     --corpus /abs/scratch/corpus.json [--variants a,b] [--concurrency 4]
   ```

   Shipped-schema variants go **through** `planHuntTasks` (probe overrides for
   model / providerOptions only), so the measured call is the deployed one.
   `results.json` is rewritten per variant; prompt text is never written, only
   its length and sha256.

3. Commit `results.json` and run the test:

   ```bash
   npx jest scripts/analysis/lum776-plan-probe/__tests__/probe-results.test.ts
   ```

## Reading the numbers

- `ok` — a schema-valid plan came back (any task count, `[]` included).
- `tasks` — planned task count; a variant that "succeeds" by always answering
  `[]` has been silenced, not fixed, which is why the test also compares the
  non-empty-plan rate against the shipped call's own successes.
- `failure.shape` — the stable classification from `describePlanFailure`
  (`budget-exhausted` / `empty-output` / `schema-mismatch` / `timeout` /
  `transport` / `unknown`), the same value production writes to
  `huntAudit.planFailure.shape`.
