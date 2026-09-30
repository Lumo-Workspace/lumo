/**
 * LUM-858: how long a workspace export stays downloadable. Its own module so
 * the workflow body (deterministic, no I/O imports) and the service share it.
 */
export const EXPORT_TTL_DAYS = 7
/** Workflow `sleep` duration matching EXPORT_TTL_DAYS. */
export const EXPORT_TTL = `${EXPORT_TTL_DAYS}d`
