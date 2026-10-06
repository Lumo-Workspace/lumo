-- LUM-1011 follow-up: backfill per-step results for runs recorded before
-- stepResults existed (user ruling, 2026-10-06):
--   * PASS                  -> every step and every verification item PASS,
--                              except verification items declared unobserved
--                              (unprovenVerification) — those stay unrecorded.
--   * FAIL with a locator   -> every item before the failure point PASS, the
--                              failing item FAIL (text = failedStepText snapshot).
--   * FAIL without locator, BLOCKED -> untouched (nothing to infer from).
-- Only rows whose stepResults is still '[]' are touched, so runs that already
-- report per-step results and re-runs of this script are no-ops.
-- A FAIL run whose failedStepText no longer matches the case's current text at
-- that index is skipped: the case was rewritten since, so positions are unsafe.
-- Each inferred entry carries "backfilled": true (readers ignore unknown keys).

WITH runs AS (
  SELECT
    r.id,
    r.result::text AS result,
    r."failedPhase"::text AS failed_phase,
    r."failedIndex" AS failed_index,
    r."failedStepText" AS failed_text,
    CASE WHEN jsonb_typeof(r."unprovenVerification") = 'array'
         THEN r."unprovenVerification" ELSE '[]'::jsonb END AS unproven,
    c.steps,
    c.verification
  FROM "test_case_runs" r
  JOIN "test_cases" c ON c.id = r."testCaseId"
  WHERE r."stepResults" = '[]'::jsonb
    AND (
      r.result = 'PASS'
      OR (
        r.result = 'FAIL'
        AND r."failedPhase" IS NOT NULL
        AND r."failedIndex" IS NOT NULL
        AND (
          r."failedStepText" IS NULL
          OR r."failedStepText" IS NOT DISTINCT FROM (
            CASE r."failedPhase"
              WHEN 'STEPS' THEN c.steps[r."failedIndex" + 1]
              ELSE c.verification[r."failedIndex" + 1]
            END
          )
        )
      )
    )
),
entries AS (
  -- STEPS that passed
  SELECT runs.id, 0 AS phase_ord, (s.n - 1)::int AS idx,
         jsonb_build_object('phase', 'STEPS', 'index', s.n - 1, 'text', s.text,
                            'status', 'PASS', 'durationMs', NULL,
                            'evidence', '[]'::jsonb, 'backfilled', true) AS e
  FROM runs, unnest(runs.steps) WITH ORDINALITY AS s(text, n)
  WHERE runs.result = 'PASS'
     OR runs.failed_phase = 'VERIFICATION'
     OR (s.n - 1) < runs.failed_index

  UNION ALL
  -- VERIFICATION items that passed (never the ones declared unobserved)
  SELECT runs.id, 1, (v.n - 1)::int,
         jsonb_build_object('phase', 'VERIFICATION', 'index', v.n - 1, 'text', v.text,
                            'status', 'PASS', 'durationMs', NULL,
                            'evidence', '[]'::jsonb, 'backfilled', true)
  FROM runs, unnest(runs.verification) WITH ORDINALITY AS v(text, n)
  WHERE (runs.result = 'PASS'
         OR (runs.failed_phase = 'VERIFICATION' AND (v.n - 1) < runs.failed_index))
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(runs.unproven) u
      WHERE jsonb_typeof(u) = 'object' AND u->>'index' = (v.n - 1)::text
    )

  UNION ALL
  -- the failing item itself
  SELECT runs.id, CASE runs.failed_phase WHEN 'STEPS' THEN 0 ELSE 1 END, runs.failed_index,
         jsonb_build_object('phase', runs.failed_phase, 'index', runs.failed_index,
                            'text', COALESCE(
                              runs.failed_text,
                              CASE runs.failed_phase
                                WHEN 'STEPS' THEN runs.steps[runs.failed_index + 1]
                                ELSE runs.verification[runs.failed_index + 1]
                              END,
                              ''),
                            'status', 'FAIL', 'durationMs', NULL,
                            'evidence', '[]'::jsonb, 'backfilled', true)
  FROM runs
  WHERE runs.result = 'FAIL'
)
UPDATE "test_case_runs" t
SET "stepResults" = agg.arr
FROM (
  SELECT id, jsonb_agg(e ORDER BY phase_ord, idx) AS arr
  FROM entries
  GROUP BY id
) agg
WHERE t.id = agg.id;
