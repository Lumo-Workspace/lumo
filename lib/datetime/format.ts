/**
 * Format a date as a short calendar day. `locale` should be the active
 * react-intl locale (pass undefined to follow the app language). `timeZone`,
 * when provided, renders the wall-clock day in that IANA zone; omit it to use
 * the runtime's local zone.
 */
export function formatZonedDate(
  date: Date | string,
  opts?: { locale?: string | undefined; timeZone?: string | undefined }
): string {
  return new Date(date).toLocaleDateString(opts?.locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(opts?.timeZone ? { timeZone: opts.timeZone } : {}),
  })
}
