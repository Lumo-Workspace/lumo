'use client'

import { useRouter } from 'next/navigation'
import { useIntl } from 'react-intl'

import {
  PUBLIC_LOCALES,
  PUBLIC_LOCALE_NAMES,
  type PublicLocale,
} from '@/lib/i18n/public-locale'

interface LanguageSwitcherProps {
  locale: PublicLocale
  /** Path the `?lang=` choice is applied to. */
  path: string
}

export function LanguageSwitcher({ locale, path }: LanguageSwitcherProps) {
  const intl = useIntl()
  const router = useRouter()

  return (
    <label className='flex items-center gap-2 text-body text-muted-foreground'>
      {intl.formatMessage({ id: 'security.language' })}
      <select
        className='rounded-md border bg-background px-2 py-1 text-foreground'
        value={locale}
        onChange={e => router.replace(`${path}?lang=${e.target.value}`)}
      >
        {PUBLIC_LOCALES.map(l => (
          <option key={l} value={l} lang={l}>
            {PUBLIC_LOCALE_NAMES[l]}
          </option>
        ))}
      </select>
    </label>
  )
}
