/**
 * Minimal level-gated logger — the single sanctioned place in the codebase
 * where `console.*` may be called directly (CLAUDE.md forbids `console.log` in
 * production code; ESLint `no-console` is on). Server-side only: it reads
 * `process.env`, which is not populated in the client bundle.
 *
 * Threshold: `LOG_LEVEL` (debug|info|warn|error) wins when set to a valid
 * value; otherwise `info` in production and `debug` elsewhere. Calls below the
 * threshold are dropped, so verbose `debug` traces stay out of production logs
 * but can be restored with `LOG_LEVEL=debug` — no redeploy needed. The
 * threshold is read on every call so it tracks runtime env changes.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

function thresholdRank(): number {
  const raw = process.env.LOG_LEVEL?.toLowerCase()
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') {
    return RANK[raw]
  }
  return process.env.NODE_ENV === 'production' ? RANK.info : RANK.debug
}

function emit(level: LogLevel, args: unknown[]): void {
  if (RANK[level] < thresholdRank()) return
  // The one sanctioned console usage in the codebase.
  // eslint-disable-next-line no-console
  console[level](...args)
}

export const logger = {
  debug: (...args: unknown[]): void => emit('debug', args),
  info: (...args: unknown[]): void => emit('info', args),
  warn: (...args: unknown[]): void => emit('warn', args),
  error: (...args: unknown[]): void => emit('error', args),
}
