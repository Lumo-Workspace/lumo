-- lumo:contract-phase expand shipped in #1491
-- LUM-1141: milestone exit criteria have been unread and unmapped since #1491
-- (the close gate reads only milestone test cases). Drops the
-- milestone_exit_criteria table and its three enum types, which nothing else
-- uses. Deletes all exit-criterion rows (18 active on prod at the 2026-10-15
-- check; the two milestones they held now carry milestone test cases).
ALTER TABLE "milestone_exit_criteria" DROP CONSTRAINT "milestone_exit_criteria_milestoneId_fkey";

DROP TABLE "milestone_exit_criteria";

DROP TYPE "MilestoneExitVerdict";

DROP TYPE "AcceptanceCriterionSource";

DROP TYPE "ReferentKind";
