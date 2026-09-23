-- LUM-815: link a test case to the acceptance criterion it covers.
--
-- Purely additive: one nullable column + one index + one FK. No backfill —
-- every existing case stays unlinked, which is the honest reading ("nobody
-- declared what this case covers"), not a default to be invented.
--
-- ON DELETE SET NULL is the whole deletion story on the hard-delete side: a
-- run-free criterion can be hard-deleted, and when it is, the case must
-- survive with a null reference rather than cascade away. A criterion WITH
-- verification runs is soft-deleted (deletedAt tombstone) by the service, so
-- the reference survives intact and the read side renders it as "该标准已变更".
ALTER TABLE "test_cases" ADD COLUMN "criterionId" TEXT;

CREATE INDEX "test_cases_criterionId_idx" ON "test_cases"("criterionId");

ALTER TABLE "test_cases"
  ADD CONSTRAINT "test_cases_criterionId_fkey"
  FOREIGN KEY ("criterionId") REFERENCES "acceptance_criteria"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
