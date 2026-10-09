-- LUM-1051: Codex-only hook events. Additive enum values, no data change.
ALTER TYPE "HookEventType" ADD VALUE 'PRE_COMPACT';
ALTER TYPE "HookEventType" ADD VALUE 'POST_COMPACT';
ALTER TYPE "HookEventType" ADD VALUE 'INTERRUPT';
