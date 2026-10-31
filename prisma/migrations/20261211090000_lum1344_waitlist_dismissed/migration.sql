-- LUM-1344 follow-up: platform admins can dismiss invalid waitlist entries.
-- Additive only: existing rows keep their status.
ALTER TYPE "WaitlistStatus" ADD VALUE 'DISMISSED';
