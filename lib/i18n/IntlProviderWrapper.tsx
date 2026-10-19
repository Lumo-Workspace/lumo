'use client'

import { createContext, useContext } from 'react'
import { IntlProvider } from 'react-intl'
import { DocumentLang } from './DocumentLang'
import { MESSAGES } from './messages'
import en from './en.json'

interface IntlProviderWrapperProps {
  locale: string
  children: React.ReactNode
}

/**
 * True below an IntlProviderWrapper. The root Providers mount an `en`
 * wrapper around every page; the locale-aware wrappers (workspace shell,
 * /sessions, public pages) nest inside it. Only a nested wrapper owns
 * `<html lang>`: effects run child-first, so if the root one synced too its
 * `en` would overwrite the real locale on mount. The root layout already
 * server-renders `lang='en'` for pages that never nest one.
 */
const InsideIntlProvider = createContext(false)

export function IntlProviderWrapper({
  locale,
  children,
}: IntlProviderWrapperProps) {
  const nested = useContext(InsideIntlProvider)
  // Backward compat: 'zh' → 'zh-CN' for existing users
  const mapped = locale === 'zh' ? 'zh-CN' : locale
  const resolvedLocale = mapped in MESSAGES ? mapped : 'en'
  const messages = MESSAGES[resolvedLocale] ?? en
  return (
    <InsideIntlProvider.Provider value={true}>
      {nested && <DocumentLang locale={resolvedLocale} />}
      <IntlProvider
        locale={resolvedLocale}
        messages={messages}
        defaultLocale='en'
      >
        {children}
      </IntlProvider>
    </InsideIntlProvider.Provider>
  )
}
