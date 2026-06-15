-- LUM-511 follow-up: attribute CLI-sourced crossings (spinoff laundering) via
-- their originating session when there is no hook event. Additive, nullable.
ALTER TABLE "boundary_crossings" ADD COLUMN IF NOT EXISTS "sessionId" TEXT;
