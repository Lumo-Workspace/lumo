import { useCallback, useMemo } from 'react'
import { useIntl } from 'react-intl'
import { formatTimestamp, formatDueDate } from '../utils'

/**
 * Returns locale-aware date formatting helpers.
 * Uses intl locale + translated time labels so all date displays
 * respect the user's language setting.
 */
export function useFormatDate() {
  const intl = useIntl()

  const timeMessages = useMemo(
    () => ({
      justNow: intl.formatMessage({
        id: 'time.justNow',
        defaultMessage: 'just now',
      }),
      mAgo: (m: number) =>
        intl.formatMessage(
          { id: 'time.mAgo', defaultMessage: '{m}m ago' },
          { m }
        ),
      today: intl.formatMessage({ id: 'time.today', defaultMessage: 'Today' }),
      yesterday: intl.formatMessage({
        id: 'time.yesterday',
        defaultMessage: 'Yesterday',
      }),
      tomorrow: intl.formatMessage({
        id: 'time.tomorrow',
        defaultMessage: 'Tomorrow',
      }),
    }),
    [intl]
  )

  const fmtTimestamp = useCallback(
    (date: Date | string) => formatTimestamp(date, intl.locale, timeMessages),
    [intl.locale, timeMessages]
  )

  const fmtDueDate = useCallback(
    (date: string | null | undefined) =>
      formatDueDate(date, intl.locale, timeMessages),
    [intl.locale, timeMessages]
  )

  /** Format a date with Intl.DateTimeFormat using the current locale */
  const fmtDate = useCallback(
    (date: Date | string, options?: Intl.DateTimeFormatOptions) => {
      const d = typeof date === 'string' ? new Date(date) : date
      return d.toLocaleDateString(
        intl.locale,
        options ?? { month: 'short', day: 'numeric', year: 'numeric' }
      )
    },
    [intl.locale]
  )

  return { fmtTimestamp, fmtDueDate, fmtDate, locale: intl.locale }
}
