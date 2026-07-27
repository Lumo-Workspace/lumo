/**
 * Format a date as a short calendar day, pinned to UTC. Sprint dates are
 * calendar intervals, not moments — rendering them in UTC keeps "Jun 1" as
 * Jun 1 for every viewer, independent of browser timezone. `locale` should be
 * the active react-intl locale (undefined follows the app language).
 */
export function formatCalendarDate(
  date: Date | string,
  locale?: string
): string {
  return new Date(date).toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/**
 * Same UTC-pinned calendar day as `formatCalendarDate`, minus the year — for
 * compact ranges where the year is implied by context and the column is too
 * narrow to carry it.
 */
export function formatCalendarDayShort(
  date: Date | string,
  locale?: string
): string {
  return new Date(date).toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}
