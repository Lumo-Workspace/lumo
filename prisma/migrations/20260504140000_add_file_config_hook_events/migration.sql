-- AlterEnum: add file-system and config-change hook events.
ALTER TYPE "HookEventType" ADD VALUE 'FILE_CHANGED';
ALTER TYPE "HookEventType" ADD VALUE 'CONFIG_CHANGE';
