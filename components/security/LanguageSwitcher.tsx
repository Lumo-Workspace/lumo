'use client'

import { useRouter } from 'next/navigation'
import { useIntl } from 'react-intl'

import {
  PUBLIC_LOCALES,
  PUBLIC_LOCALE_NAMES,
  type PublicLocale,
} from '@/lib/i18n/public-locale'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface LanguageSwitcherProps {
  locale: PublicLocale
  /** Path the `?lang=` choice is applied to. */
  path: string
}

export function LanguageSwitcher({ locale, path }: LanguageSwitcherProps) {
  const intl = useIntl()
  const router = useRouter()

  return (
    <div className='flex items-center gap-2 text-body text-muted-foreground'>
      <label htmlFor='security-language'>
        {intl.formatMessage({ id: 'security.language' })}
      </label>
      <Select
        value={locale}
        onValueChange={v => router.replace(`${path}?lang=${v}`)}
      >
        <SelectTrigger
          id='security-language'
          className='h-8 w-auto gap-2 bg-background text-foreground'
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PUBLIC_LOCALES.map(l => (
            <SelectItem key={l} value={l} lang={l}>
              {PUBLIC_LOCALE_NAMES[l]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
