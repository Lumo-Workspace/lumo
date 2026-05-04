-- AlterEnum: extend HookEventType with permission, session boundary,
-- subagent, worktree, and stop-failure events. Each ADD VALUE is its own
-- statement because Postgres requires enum extensions to be committed
-- before the new value is usable in the same transaction.
ALTER TYPE "HookEventType" ADD VALUE 'STOP_FAILURE';
ALTER TYPE "HookEventType" ADD VALUE 'PERMISSION_REQUEST';
ALTER TYPE "HookEventType" ADD VALUE 'PERMISSION_DENIED';
ALTER TYPE "HookEventType" ADD VALUE 'SESSION_START';
ALTER TYPE "HookEventType" ADD VALUE 'SESSION_END';
ALTER TYPE "HookEventType" ADD VALUE 'SUBAGENT_START';
ALTER TYPE "HookEventType" ADD VALUE 'SUBAGENT_STOP';
ALTER TYPE "HookEventType" ADD VALUE 'WORKTREE_CREATE';
ALTER TYPE "HookEventType" ADD VALUE 'WORKTREE_REMOVE';
