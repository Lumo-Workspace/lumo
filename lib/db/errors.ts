/**
 * Narrow type guards for Prisma known-request errors.
 *
 * Only P2002 is implemented because that's what the current refactor needs.
 * Extend here when other domains need P2025 / P2003 / etc.
 */
export function isPrismaUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'P2002'
  )
}
