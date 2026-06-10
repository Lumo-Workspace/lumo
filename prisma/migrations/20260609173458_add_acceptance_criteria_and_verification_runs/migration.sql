-- CreateEnum
CREATE TYPE "AcceptanceVerifierType" AS ENUM ('MACHINE', 'HUMAN');

-- CreateEnum
CREATE TYPE "AcceptanceCriterionSource" AS ENUM ('AGENT_DRAFT', 'HUMAN_EDIT', 'REVIEW_ADDED');

-- CreateEnum
CREATE TYPE "VerificationVerdict" AS ENUM ('PASS', 'FAIL', 'PASS_WITH_FOLLOWUP');

-- CreateEnum
CREATE TYPE "VerificationRejectionReason" AS ENUM ('CRITERION_UNMET', 'EVIDENCE_INSUFFICIENT', 'CHECK_EXECUTION_ERROR', 'SCOPE_MISMATCH', 'OTHER');

-- CreateTable
CREATE TABLE "acceptance_criteria" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "verifierType" "AcceptanceVerifierType" NOT NULL,
    "checkpointer" TEXT,
    "evidenceRequired" BOOLEAN NOT NULL DEFAULT false,
    "source" "AcceptanceCriterionSource" NOT NULL,
    "addedAtRound" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "acceptance_criteria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_runs" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "verifierType" "AcceptanceVerifierType" NOT NULL,
    "verdict" "VerificationVerdict" NOT NULL,
    "evidencePointer" TEXT,
    "rejectionReason" TEXT,
    "rejectionReasonEnum" "VerificationRejectionReason",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "acceptance_criteria_taskId_idx" ON "acceptance_criteria"("taskId");

-- CreateIndex
CREATE INDEX "verification_runs_taskId_round_idx" ON "verification_runs"("taskId", "round");

-- CreateIndex
CREATE INDEX "verification_runs_criterionId_idx" ON "verification_runs"("criterionId");

-- AddForeignKey
ALTER TABLE "acceptance_criteria" ADD CONSTRAINT "acceptance_criteria_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_runs" ADD CONSTRAINT "verification_runs_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_runs" ADD CONSTRAINT "verification_runs_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "acceptance_criteria"("id") ON DELETE CASCADE ON UPDATE CASCADE;

