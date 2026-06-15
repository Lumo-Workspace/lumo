-- LUM-511 Phase 4: judge-confirmed laundering markers + contract-weakening crossing.
ALTER TYPE "TaskActivityType" ADD VALUE IF NOT EXISTS 'SPINOFF_LAUNDERED';
ALTER TYPE "TaskActivityType" ADD VALUE IF NOT EXISTS 'SILENT_FIX_DETECTED';
ALTER TYPE "BoundaryCrossingCategory" ADD VALUE IF NOT EXISTS 'CONTRACT_WEAKENING';
