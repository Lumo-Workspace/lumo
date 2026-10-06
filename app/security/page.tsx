import type { Metadata } from 'next'
import { headers } from 'next/headers'

import { SecurityPage } from '@/components/security/SecurityPage'
import { IntlProviderWrapper } from '@/lib/i18n/IntlProviderWrapper'
import { MESSAGES } from '@/lib/i18n/messages'
import { resolvePublicLocale } from '@/lib/i18n/public-locale'
import { RETENTION_FIGURES } from '@/lib/legal/retention-figures'
import { buildSubprocessorPageView } from '@/lib/legal/subprocessor-change-log'
import { SUBPROCESSOR_CHANGES } from '@/lib/legal/subprocessor-changes'
import {
  AI_HOST_SUBPROCESSORS,
  INFRASTRUCTURE_SUBPROCESSORS,
} from '@/lib/legal/subprocessors'

interface PageProps {
  searchParams: Promise<{ lang?: string | string[] }>
}

async function localeFor(searchParams: PageProps['searchParams']) {
  const { lang } = await searchParams
  const acceptLanguage = (await headers()).get('accept-language')
  return resolvePublicLocale({
    lang: Array.isArray(lang) ? lang[0] : lang,
    acceptLanguage,
  })
}

export async function generateMetadata({
  searchParams,
}: PageProps): Promise<Metadata> {
  const locale = await localeFor(searchParams)
  // react-intl's createIntl is a client export, and these two strings carry
  // no ICU arguments — read them straight from the catalogue.
  const messages = MESSAGES[locale] ?? {}
  return {
    title: messages['security.meta.title'] ?? null,
    description: messages['security.meta.description'] ?? null,
  }
}

/** Public trust page (LUM-856) — no sign-in; locale from ?lang= or the browser. */
export default async function Page({ searchParams }: PageProps) {
  const locale = await localeFor(searchParams)
  // LUM-919: which announced changes are in effect is a per-request fact (the
  // page is dynamic — it reads the request headers above).
  const subprocessors = buildSubprocessorPageView({
    infrastructure: INFRASTRUCTURE_SUBPROCESSORS,
    aiHosts: AI_HOST_SUBPROCESSORS,
    changes: SUBPROCESSOR_CHANGES,
    now: new Date(),
  })
  return (
    <IntlProviderWrapper locale={locale}>
      <SecurityPage
        locale={locale}
        retentionFigures={RETENTION_FIGURES}
        subprocessors={subprocessors}
      />
    </IntlProviderWrapper>
  )
}
