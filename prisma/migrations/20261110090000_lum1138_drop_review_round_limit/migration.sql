-- lumo:contract-phase expand shipped in #1478
-- LUM-1138: PullRequest.reviewRoundLimit has been unread since #1468 (LUM-1137)
-- and unmapped (@ignore) since #1478. Dropping it also drops its CHECK
-- constraint "pull_requests_reviewRoundLimit_check". Deletes the column data.
ALTER TABLE "pull_requests" DROP COLUMN "reviewRoundLimit";
