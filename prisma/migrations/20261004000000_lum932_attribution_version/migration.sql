-- LUM-932 P3: optimistic version for per-family attribution recomputes.
-- Additive; constant default (no table rewrite on PG >= 11).
ALTER TABLE "sessions" ADD COLUMN "attributionVersion" INTEGER NOT NULL DEFAULT 0;
