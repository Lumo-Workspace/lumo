'use client'

import { IntlProvider } from 'react-intl'
import { MESSAGES } from './messages'
import en from './en.json'

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
