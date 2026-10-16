-- LUM-1211: backfill per-step results for every PASS run that still has none
-- (user ruling, 2026-10-16: "a passed test case means every step passed").
--   * every step and every verification item -> PASS
--   * verification items the run declared unobserved (unprovenVerification)
--     -> SKIP with reason 'Declared unobserved when recorded' — that was a
--     reported fact, not something to infer.
-- Unlike the LUM-1011 backfill (20261020090000), runs older than the case's last
-- edit are NOT skipped: the ruling covers every passed run. Step text comes from
-- the case's current steps; "backfilled": true marks the inference.
-- FAIL / BLOCKED runs are untouched. Only rows whose stepResults is still '[]'
-- are touched, so re-running this is a no-op. Covers task and milestone cases
-- (both live in test_cases / test_case_runs).

WITH runs AS (
  SELECT
    r.id,
    CASE WHEN jsonb_typeof(r."unprovenVerification") = 'array'
         THEN r."unprovenVerification" ELSE '[]'::jsonb END AS unproven,
    c.steps,
    c.verification
  FROM "test_case_runs" r
  JOIN "test_cases" c ON c.id = r."testCaseId"
  WHERE r."stepResults" = '[]'::jsonb
    AND r.result = 'PASS'
    AND (cardinality(c.steps) + cardinality(c.verification)) > 0
),
entries AS (
  SELECT runs.id, 0 AS phase_ord, (s.n - 1)::int AS idx,
         jsonb_build_object('phase', 'STEPS', 'index', s.n - 1, 'text', s.text,
                            'status', 'PASS', 'reason', NULL, 'durationMs', NULL,
                            'evidence', '[]'::jsonb, 'backfilled', true) AS e
  FROM runs, unnest(runs.steps) WITH ORDINALITY AS s(text, n)

  UNION ALL
  SELECT runs.id, 1, (v.n - 1)::int,
         jsonb_build_object('phase', 'VERIFICATION', 'index', v.n - 1, 'text', v.text,
                            'status', CASE WHEN unobserved.hit THEN 'SKIP' ELSE 'PASS' END,
                            'reason', CASE WHEN unobserved.hit
                                           THEN 'Declared unobserved when recorded'
                                           ELSE NULL END,
                            'durationMs', NULL,
                            'evidence', '[]'::jsonb, 'backfilled', true)
  FROM runs
  CROSS JOIN LATERAL unnest(runs.verification) WITH ORDINALITY AS v(text, n)
  CROSS JOIN LATERAL (
    SELECT EXISTS (
      SELECT 1 FROM jsonb_array_elements(runs.unproven) u
      WHERE jsonb_typeof(u) = 'object' AND u->>'index' = (v.n - 1)::text
    ) AS hit
  ) unobserved
)
UPDATE "test_case_runs" t
SET "stepResults" = agg.arr
FROM (
  SELECT id, jsonb_agg(e ORDER BY phase_ord, idx) AS arr
  FROM entries
  GROUP BY id
) agg
WHERE t.id = agg.id;
