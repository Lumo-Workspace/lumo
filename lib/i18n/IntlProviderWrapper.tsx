'use client'

import { IntlProvider } from 'react-intl'
import en from './en.json'
import zhCN from './zh-CN.json'
import zhTW from './zh-TW.json'
import enGB from './en-GB.json'
import enAU from './en-AU.json'
import es from './es.json'
import es419 from './es-419.json'
import fr from './fr.json'
import de from './de.json'
import ja from './ja.json'
import ko from './ko.json'
import hi from './hi.json'
import ru from './ru.json'
import vi from './vi.json'
import id from './id.json'
import ms from './ms.json'

const MESSAGES: Record<string, Record<string, string>> = {
  en,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'en-GB': enGB,
  'en-AU': enAU,
  'es-ES': es,
  'es-419': es419,
  fr,
  de,
  ja,
  ko,
  hi,
  ru,
  vi,
  id,
  ms,
}

interface IntlProviderWrapperProps {
  locale: string
  children: React.ReactNode
}

export function IntlProviderWrapper({
  locale,
  children,
}: IntlProviderWrapperProps) {
  // Backward compat: 'zh' → 'zh-CN' for existing users
  const mapped = locale === 'zh' ? 'zh-CN' : locale
  const resolvedLocale = mapped in MESSAGES ? mapped : 'en'
  const messages = MESSAGES[resolvedLocale] ?? en
  return (
    <IntlProvider
      locale={resolvedLocale}
      messages={messages}
      defaultLocale='en'
    >
      {children}
    </IntlProvider>
  )
}
