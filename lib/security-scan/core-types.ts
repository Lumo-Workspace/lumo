/**
 * LUM-1255 — moved to `shared/src/secret-scan/core-types` so the CLI (`lumo scan secrets`) runs
 * the exact scanner the PR scan runs. Re-exported here so existing imports keep working.
 */
export * from '@/shared/src/secret-scan/core-types'
