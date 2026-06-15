-- LUM-511 Phase 6: surface judge-confirmed laundering as boundary crossings.
ALTER TYPE "BoundaryCrossingCategory" ADD VALUE IF NOT EXISTS 'SPINOFF_LAUNDERED';
ALTER TYPE "BoundaryCrossingCategory" ADD VALUE IF NOT EXISTS 'SILENT_FIX';
