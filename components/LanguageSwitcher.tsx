'use client'

import { Globe } from 'lucide-react'
import { useIntl } from 'react-intl'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  QUICK_SWITCH_LOCALES,
  SUPPORTED_LOCALES,
  withCurrentLocale,
  type LocaleOption,
} from '@/lib/i18n/locales'

interface LanguageSwitcherProps {
  /** The currently selected locale value. */
  value: string
  /** Called with the newly picked locale value. */
  onChange: (locale: string) => void
  /** Which locales to offer. Defaults to the quick-switch subset. */
  options?: readonly LocaleOption[]
  /** Renders the compact, icon-led trigger used in a page header. */
  compact?: boolean
  disabled?: boolean
  className?: string
}

/**
 * A language picker, and nothing else.
 *
 * It neither reads nor writes preferences: the parent owns the value and the
 * write. That keeps one component serving both the page header (where the
 * value comes from the preferences hook) and the Preferences page (where it
 * comes from the same hook one level up) without either usage inheriting the
 * other's data-fetching.
 *
 * Option labels are endonyms and stay untranslated by design — see
 * `lib/i18n/locales.ts`.
 */
export function LanguageSwitcher({
  value,
  onChange,
  options = QUICK_SWITCH_LOCALES,
  compact = false,
  disabled = false,
  className,
}: LanguageSwitcherProps) {
  const intl = useIntl()
  const label = intl.formatMessage({ id: 'language.switcher.label' })

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        aria-label={label}
        title={label}
        className={
          className ??
          (compact
            ? 'h-7 w-auto gap-1.5 border-none bg-transparent px-2 text-caption text-muted-foreground shadow-none hover:text-foreground focus:ring-0 focus:ring-offset-0'
            : 'h-8 w-48 text-body')
        }
      >
        {compact ? <Globe size={14} className='shrink-0' /> : null}
        <SelectValue />
      </SelectTrigger>
      <SelectContent align={compact ? 'end' : 'start'}>
        {withCurrentLocale(options, value).map(option => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** The full locale set, for callers that want every language (Preferences). */
export { SUPPORTED_LOCALES }
