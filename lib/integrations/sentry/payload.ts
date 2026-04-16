import type { TaskPriority } from '@prisma/client'

/**
 * Map a Sentry level string to a Lumo TaskPriority.
 * Unknown / missing levels → LOW.
 */
export function mapLevelToPriority(
  level: string | undefined | null
): TaskPriority {
  switch (level) {
    case 'fatal':
      return 'URGENT'
    case 'error':
      return 'HIGH'
    case 'warning':
      return 'MEDIUM'
    default:
      return 'LOW'
  }
}
