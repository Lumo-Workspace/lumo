-- LUM-516: reclassify boundary-crossing reversibility on the world/external-state
-- boundary. Data-only — recomputes a fully-derivable boolean column; no schema
-- change, no row deleted. Idempotent / safe to re-run. Production applies via
-- `prisma migrate deploy` on next deploy.
--
-- Irreversible = destroys external world state git/Lumo can't restore. Everything
-- else (editorial / in-repo / in-Lumo) is reversible. The five names below all
-- exist as enum values since LUM-442; keep this list in sync with isReversible's
-- irreversible complement (lib/services/boundary-detector.service.ts).

UPDATE "boundary_crossings" SET "reversible" = false
  WHERE "category" IN (
    'HARDCODED_SECRET', 'DESTRUCTIVE_DB_COMMAND', 'EXFILTRATION_PUBLIC',
    'CLOUD_DATA_DELETION', 'INFRA_TERMINATION'
  );

UPDATE "boundary_crossings" SET "reversible" = true
  WHERE "category" NOT IN (
    'HARDCODED_SECRET', 'DESTRUCTIVE_DB_COMMAND', 'EXFILTRATION_PUBLIC',
    'CLOUD_DATA_DELETION', 'INFRA_TERMINATION'
  );
