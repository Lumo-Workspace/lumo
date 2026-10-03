-- LUM-942 follow-up: remove the task "Delivery checks" panel (formerly the
-- "Evidence & audit trail" card) and the CI-signal ingestion that only fed it.
--
-- DATA-DESTRUCTIVE: permanently deletes every gate_signals row (CI check-run /
-- commit-status results recorded per task + PR, including the historical
-- 'lumo_sandbox' verdicts of the retired managed CI). lumo_ci_runs is kept.
DROP TABLE IF EXISTS "gate_signals";
