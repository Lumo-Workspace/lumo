-- LUM-942 follow-up: drop the retired Lumo-managed CI run log (LUM-746, retired
-- in LUM-837). Nothing has written it since LUM-837, and its verdicts lived in
-- gate_signals, which LUM-942 already dropped.
--
-- DATA-DESTRUCTIVE: permanently deletes every lumo_ci_runs row.
DROP TABLE IF EXISTS "lumo_ci_runs";
