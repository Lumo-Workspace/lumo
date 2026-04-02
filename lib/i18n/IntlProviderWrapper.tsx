'use client'

import { IntlProvider } from 'react-intl'
import en from './en.json'
import zh from './zh.json'

const MESSAGES: Record<string, Record<string, string>> = { en, zh }

interface IntlProviderWrapperProps {
  locale: string
  children: React.ReactNode
}

export function IntlProviderWrapper({
  locale,
  children,
}: IntlProviderWrapperProps) {
  const resolvedLocale = locale in MESSAGES ? locale : 'en'
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
