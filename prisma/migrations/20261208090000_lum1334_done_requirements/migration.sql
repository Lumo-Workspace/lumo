-- LUM-1334: two OWNER switches that tighten the DONE gate (both off by
-- default), and the GitHub reviews the review requirement reads. Additive.
ALTER TABLE "workspaces" ADD COLUMN "doneRequiresTestCase" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "workspaces" ADD COLUMN "doneRequiresReview" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "pull_request_reviews" (
    "id" TEXT NOT NULL,
    "pullRequestId" TEXT NOT NULL,
    "githubReviewId" TEXT NOT NULL,
    "reviewerLogin" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pull_request_reviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pull_request_reviews_pullRequestId_githubReviewId_key" ON "pull_request_reviews"("pullRequestId", "githubReviewId");

ALTER TABLE "pull_request_reviews" ADD CONSTRAINT "pull_request_reviews_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "pull_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
