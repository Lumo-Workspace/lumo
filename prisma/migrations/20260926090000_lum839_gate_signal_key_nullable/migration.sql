-- LUM-839: CI checks are shown by their own names, no longer classified into
-- typecheck/build/test gate keys. New gate_signals rows leave gateKey empty.
-- Additive: relaxes a NOT NULL constraint only; existing rows are unchanged.
ALTER TABLE "gate_signals" ALTER COLUMN "gateKey" DROP NOT NULL;
