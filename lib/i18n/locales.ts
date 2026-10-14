/**
 * The single source of truth for which locales the UI offers and how each one
 * is labelled.
 *
 * Before this module the list lived inline in the Preferences page. A second
 * switcher (the project header) would have meant a second copy, and two copies
 * of a list drift: a locale added to one renders as an option the other cannot
 * show. Both switchers now read from here, so they cannot disagree with each
 * other. Keeping this list in step with the message catalogues is still manual
 * (see SUPPORTED_LOCALES), guarded by a test rather than the compiler.
 *
 * Labels are deliberately NOT run through react-intl — a language picker is
 * read by someone who wants to *leave* the current language, so each option is
 * written in its own language (endonym) and stays legible whatever the app is
 * currently rendering in.
 */

export interface LocaleOption {
  /** The value stored on the user's preference record. */
  readonly value: string
  /** The language's own name for itself. Never translated. */
  readonly label: string
}

/**
 * Every locale with a message catalogue in this directory, ordered as the
 * Preferences page has always ordered them (by endonym, Latin script first).
 * Keep in step with the MESSAGES map in IntlProviderWrapper.tsx.
 */
export const SUPPORTED_LOCALES = [
  { value: 'id', label: 'Bahasa Indonesia' },
  { value: 'ms', label: 'Bahasa Melayu' },
  { value: 'de', label: 'Deutsch' },
  { value: 'en', label: 'English (US)' },
  { value: 'en-AU', label: 'English (Australia)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'es-419', label: 'Español (Latinoamérica)' },
  { value: 'es-ES', label: 'Español (España)' },
  { value: 'fr', label: 'Français' },
  { value: 'vi', label: 'Tiếng Việt' },
  { value: 'ru', label: 'Русский' },
  { value: 'hi', label: 'हिन्दी' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
] as const satisfies readonly LocaleOption[]

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]['value']

/**
 * The subset the in-page quick switcher offers.
 *
 * The header switcher is a shortcut, not a replacement for Preferences: it
 * carries the two languages this team actually reads, and Preferences keeps
 * the full set reachable. Widening it later is an edit to this array alone —
 * which is the reason the full list and the subset are separate constants
 * rather than one list with a flag.
 */
export const QUICK_SWITCH_LOCALE_VALUES: readonly SupportedLocale[] = [
  'en',
  'zh-CN',
]

/** The quick-switch subset, resolved to options (order follows the subset). */
export const QUICK_SWITCH_LOCALES: readonly LocaleOption[] =
  QUICK_SWITCH_LOCALE_VALUES.map(
    value => SUPPORTED_LOCALES.find(o => o.value === value) as LocaleOption
  )

/**
 * The options a switcher should render for the viewer's current locale: the
 * given options, plus the current locale when it is supported but not among
 * them. Without this, a viewer whose locale sits outside the quick-switch
 * subset (say `fr`) would see a blank trigger, with no hint of what they have.
 */
export function withCurrentLocale(
  options: readonly LocaleOption[],
  value: string
): readonly LocaleOption[] {
  if (options.some(o => o.value === value)) return options
  const current = SUPPORTED_LOCALES.find(o => o.value === value)
  return current ? [...options, current] : options
}

/**
 * Legacy preference values that predate the current locale set.
 * `zh` was the original Chinese option, split into zh-CN / zh-TW later.
 */
const LEGACY_ALIASES: Record<string, SupportedLocale> = { zh: 'zh-CN' }

/**
 * Resolve a stored preference to a locale the UI can render, falling back to
 * English. Mirrors what IntlProviderWrapper does for messages, so a value the
 * provider falls back on does not leave a switcher showing a blank trigger.
 */
export function resolveLocale(
  value: string | null | undefined
): SupportedLocale {
  if (!value) return 'en'
  const mapped = LEGACY_ALIASES[value] ?? value
  return SUPPORTED_LOCALES.some(o => o.value === mapped)
    ? (mapped as SupportedLocale)
    : 'en'
}
