-- LUM-962: new boundary-crossing category for running code from an unvetted
-- source (pip install git+/URL, curl | sh, download-then-execute).
--
-- Additive only: one enum value, no DROP, no backfill. Historical
-- NEW_NPM_DEPENDENCY rows keep their category (an npm install from a git/URL
-- spec recorded before this change stays LOW). PostgreSQL forbids USING a
-- just-added enum value in the same transaction — this file only adds it.
ALTER TYPE "BoundaryCrossingCategory" ADD VALUE 'UNTRUSTED_CODE_EXECUTION';
