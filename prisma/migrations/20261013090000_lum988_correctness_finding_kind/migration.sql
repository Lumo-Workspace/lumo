-- LUM-988: non-security findings from the AI review. Additive: no existing
-- row changes, and nothing in this migration uses the new value (PostgreSQL
-- cannot use an enum value in the transaction that adds it).
ALTER TYPE "PrSecurityFindingKind" ADD VALUE 'CORRECTNESS';
