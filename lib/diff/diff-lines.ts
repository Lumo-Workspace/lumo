/**
 * LUM-1255 — moved to `shared/src/diff-lines` so the CLI (`lumo scan secrets`) runs
 * the exact scanner the PR scan runs. Re-exported here so existing imports keep working.
 */
export * from '@/shared/src/diff-lines'
