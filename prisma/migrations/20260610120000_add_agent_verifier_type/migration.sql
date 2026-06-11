-- LUM-422: agent-initiated send-back channel.
-- Additive enum value only — no data migration, no destructive step.
-- Production applies via `prisma migrate deploy` on next deploy.
ALTER TYPE "AcceptanceVerifierType" ADD VALUE 'AGENT';
