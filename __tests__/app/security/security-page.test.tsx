/**
 * @jest-environment node
 */

// clerkMiddleware() checks for keys at import time (see proxy.matcher.test.ts).
process.env.CLERK_SECRET_KEY = 'sk_test_dummy'
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_dummy'

import { readFileSync } from 'fs'
import { join } from 'path'

import { createRouteMatcher } from '@clerk/nextjs/server'
import { NextRequest } from 'next/server'
import { renderToStaticMarkup } from 'react-dom/server'

import { SecurityPage } from '@/components/security/SecurityPage'
import { IntlProviderWrapper } from '@/lib/i18n/IntlProviderWrapper'
import { MESSAGES } from '@/lib/i18n/messages'
import { PUBLIC_LOCALES, type PublicLocale } from '@/lib/i18n/public-locale'
import {
  AI_HOST_SUBPROCESSORS,
  CUSTOMER_INTEGRATIONS,
  INFRASTRUCTURE_SUBPROCESSORS,
  SECURITY_CONTACT_EMAIL,
} from '@/lib/legal/subprocessors'
import { EXPORT_TTL_DAYS } from '@/lib/workspace/export-ttl'
import { PUBLIC_ROUTES } from '@/proxy'
import { generateMetadata } from '@/app/security/page'

let acceptLanguage: string | null = null
jest.mock('next/headers', () => ({
  headers: async () =>
    new Headers(acceptLanguage ? { 'accept-language': acceptLanguage } : {}),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn() }),
}))

// react-intl ships ESM jest can't load (repo convention: mock it). This mock
// keeps the provider → useIntl wiring, so the page reads the REAL catalogue
// that IntlProviderWrapper picks for the locale.
jest.mock('react-intl', () => {
  const React = jest.requireActual('react')
  const Ctx = React.createContext(null)
  const makeIntl = (locale: string, messages: Record<string, string>) => ({
    locale,
    formatMessage: (
      { id }: { id: string },
      values: Record<string, unknown> = {}
    ) => {
      const msg = messages[id]
      if (msg === undefined) throw new Error(`missing i18n key: ${id}`)
      const parts = msg
        .split(/\{(\w+)\}/)
        .map((part, i) => (i % 2 === 1 ? values[part] : part))
      return parts.every(p => typeof p === 'string')
        ? parts.join('')
        : parts.map((p, i) =>
            React.createElement(React.Fragment, { key: i }, p)
          )
    },
    formatDate: (value: string, opts: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(locale, opts).format(new Date(value)),
  })
  return {
    IntlProvider: ({
      locale,
      messages,
      children,
    }: {
      locale: string
      messages: Record<string, string>
      children: unknown
    }) =>
      React.createElement(
        Ctx.Provider,
        { value: makeIntl(locale, messages) },
        children
      ),
    useIntl: () => React.useContext(Ctx),
  }
})

const SECTION_HEADINGS = [
  'security.infra.heading',
  'security.auth.heading',
  'security.code.heading',
  'security.subprocessors.heading',
  'security.report.heading',
]

/** Locales written in English — the only ones allowed to reuse en wording. */
const ENGLISH = new Set<PublicLocale>(['en', 'en-GB', 'en-AU'])

function render(locale: PublicLocale): string {
  return renderToStaticMarkup(
    <IntlProviderWrapper locale={locale}>
      <SecurityPage locale={locale} />
    </IntlProviderWrapper>
  )
}

/** Undo the HTML escaping renderToStaticMarkup applies to text. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
}

const securityKeys = Object.keys(MESSAGES.en!).filter(k =>
  k.startsWith('security.')
)

describe('/security page (LUM-856)', () => {
  it('security page renders every section in each locale', () => {
    const problems: string[] = []
    for (const locale of PUBLIC_LOCALES) {
      const messages = MESSAGES[locale]!
      const page = text(render(locale))

      for (const key of SECTION_HEADINGS)
        if (!page.includes(messages[key]!))
          problems.push(`${locale}: heading ${key} not rendered`)
      if (!page.includes(SECURITY_CONTACT_EMAIL))
        problems.push(`${locale}: contact email missing`)
      if (page.includes('[TODO:'))
        problems.push(`${locale}: placeholder text rendered`)

      for (const key of securityKeys) {
        const value = messages[key] ?? ''
        if (value.includes('[TODO:'))
          problems.push(`${locale}: ${key} is a placeholder`)
        // A one-word cognate (fr "Service") is a real translation; an
        // identical sentence is not.
        if (
          !ENGLISH.has(locale) &&
          value === MESSAGES.en![key] &&
          value.includes(' ')
        )
          problems.push(`${locale}: ${key} is untranslated English`)
      }
    }
    expect(problems).toEqual([])
  })

  it('security page describes the shipped workspace export', () => {
    // LUM-853: LUM-858 shipped an owner-only export, so /security may no
    // longer list export as missing — and must say the export is partial.
    expect(MESSAGES.en!['security.notYet.body']).not.toMatch(
      /does not yet offer workspace data export/
    )
    expect(MESSAGES.en!['security.notYet.body']).toMatch(
      /workspace export that includes every record/
    )
    expect(MESSAGES.en!['security.code.export']).toMatch(
      new RegExp(`works for ${EXPORT_TTL_DAYS} days`)
    )
    expect(MESSAGES.en!['security.code.export']).toMatch(
      /does not yet include everything/
    )
    expect(MESSAGES.en!['security.code.deletion']).toMatch(/48 hours/)
    // Read from source: importing trash.service would load Prisma.
    const TRASH_RETENTION_DAYS = Number(
      /TRASH_RETENTION_DAYS = (\d+)/.exec(
        readFileSync(
          join(process.cwd(), 'lib/services/trash.service.ts'),
          'utf8'
        )
      )?.[1]
    )
    expect(MESSAGES.en!['security.code.deletion']).toMatch(
      new RegExp(`trash for ${TRASH_RETENTION_DAYS} days`)
    )

    const problems: string[] = []
    for (const locale of PUBLIC_LOCALES) {
      const messages = MESSAGES[locale]!
      const page = text(render(locale))
      const exportText = messages['security.code.export'] ?? ''
      const deletion = messages['security.code.deletion'] ?? ''
      if (!exportText || !page.includes(exportText))
        problems.push(`${locale}: export paragraph not rendered`)
      if (!exportText.includes(String(EXPORT_TTL_DAYS)))
        problems.push(`${locale}: export TTL missing`)
      if (!deletion.includes('48') || !deletion.includes('30'))
        problems.push(`${locale}: deletion window or trash days missing`)
    }
    expect(problems).toEqual([])
  })

  it('security export copy lists uploaded files among what it leaves out', () => {
    // LUM-853 review: the export reads no blobs (editor images, test-case
    // evidence), so the "left out" list must name uploaded files.
    const leftOut =
      /does not yet include everything Lumo stores:(.*)are left out\./.exec(
        MESSAGES.en!['security.code.export'] ?? ''
      )?.[1]
    expect(leftOut).toMatch(/uploaded files and images/)

    // Every non-English locale carries its own translation, not the English
    // sentence, and the zh locales name initiatives/sprints as the sidebar does.
    const problems: string[] = []
    for (const locale of PUBLIC_LOCALES) {
      const exportText = MESSAGES[locale]!['security.code.export'] ?? ''
      if (!locale.startsWith('en') && exportText.includes('uploaded files'))
        problems.push(`${locale}: English fallback`)
    }
    for (const locale of ['zh-CN', 'zh-TW']) {
      const messages = MESSAGES[locale]!
      const exportText = messages['security.code.export'] ?? ''
      for (const key of ['sidebar.initiatives', 'sidebar.sprints']) {
        const term = messages[key] ?? ''
        if (!term || !exportText.includes(term))
          problems.push(`${locale}: export copy does not use ${key} "${term}"`)
      }
    }
    expect(problems).toEqual([])
  })

  it('renders every subprocessor from the registry', () => {
    const page = text(render('en'))
    const names = [
      ...INFRASTRUCTURE_SUBPROCESSORS.flatMap(s => [s.product, s.entity]),
      ...AI_HOST_SUBPROCESSORS.map(h => h.entity),
      ...CUSTOMER_INTEGRATIONS.flatMap(i => [i.product, i.provider]),
    ]
    expect(names.filter(n => !page.includes(n))).toEqual([])
  })

  it('marks the page with the rendered locale', () => {
    expect(render('ja')).toContain('lang="ja"')
  })

  it('localizes page metadata from ?lang= or Accept-Language', async () => {
    acceptLanguage = 'ko-KR,ko;q=0.9'
    const byHeader = await generateMetadata({
      searchParams: Promise.resolve({}),
    })
    expect(byHeader.title).toBe(MESSAGES.ko!['security.meta.title'])

    const byParam = await generateMetadata({
      searchParams: Promise.resolve({ lang: 'fr' }),
    })
    expect(byParam.title).toBe(MESSAGES.fr!['security.meta.title'])
    expect(byParam.description).toBe(MESSAGES.fr!['security.meta.description'])
  })

  it('security route is public in the auth proxy', () => {
    const isPublic = createRouteMatcher(PUBLIC_ROUTES)
    const req = (p: string) => new NextRequest(`https://www.uselumo.ai${p}`)
    expect(isPublic(req('/security'))).toBe(true)
    expect(isPublic(req('/security?lang=zh-CN'))).toBe(true)
    // Control: the matcher still protects app routes.
    expect(isPublic(req('/workspace/acme'))).toBe(false)
  })
})
