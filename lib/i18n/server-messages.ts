/**
 * Server-side message lookup (LUM-1097) for text Lumo writes outside the
 * browser — Slack messages today. react-intl's `createIntl` is a client
 * export, so this reads the same catalogues (`MESSAGES`) directly.
 *
 * Only plain `{name}` placeholders are supported (no ICU plural/select): the
 * keys formatted here are written without them, and a placeholder with no
 * value is left as-is so a missing value is visible rather than silent.
 */
import { MESSAGES } from './messages'
import { PUBLIC_LOCALES, type PublicLocale } from './public-locale'

/** The language codes a workspace or member can choose (UserPreference.locale). */
export const SUPPORTED_LOCALES = PUBLIC_LOCALES
export type SupportedLocale = PublicLocale
export const DEFAULT_LOCALE: SupportedLocale = 'en'

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return (
    typeof value === 'string' &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  )
}

/** A stored locale code, or `fallback` when it is missing or unknown. */
export function toSupportedLocale(
  value: string | null | undefined,
  fallback: SupportedLocale = DEFAULT_LOCALE
): SupportedLocale {
  return isSupportedLocale(value) ? value : fallback
}

export type MessageValues = Record<string, string | number>

/**
 * The message `id` in `locale`, with `{name}` placeholders filled from
 * `values`. Every locale carries every key (i18n parity test); the en
 * catalogue and then the id itself are only a guard against a missing key.
 */
export function formatServerMessage(
  locale: SupportedLocale,
  id: string,
  values: MessageValues = {}
): string {
  const template =
    MESSAGES[locale]?.[id] ?? MESSAGES[DEFAULT_LOCALE]?.[id] ?? id
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name)
      ? String(values[name])
      : whole
  )
}
