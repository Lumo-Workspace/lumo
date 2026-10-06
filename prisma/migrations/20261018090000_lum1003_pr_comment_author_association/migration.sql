-- LUM-1003: GitHub author_association of a mirrored PR comment's author
-- (additive, nullable; existing rows stay NULL = unverified reviewer).
ALTER TABLE "pr_comment_mirrors" ADD COLUMN "authorAssociation" TEXT;
