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
import { RETENTION_FIGURES } from '@/lib/legal/retention-figures'
import {
  HOOK_EVENT_RETENTION_DAYS,
  USED_UP_AUDIT_WAIT_CAP_DAYS,
  USED_UP_GRACE_DAYS,
  USED_UP_IDLE_DAYS,
} from '@/lib/hook-event/retention'
import { FAILURE_ERROR_CAP } from '@/lib/hook-payload/redact'
import {
  CROSSING_RAW_RETENTION_DAYS,
  DEFAULT_CROSSING_RAW_RETENTION_DAYS,
} from '@/lib/boundary-crossing/raw-retention'
import {
  DEAD_LETTER_PAYLOAD_RETENTION_DAYS,
  DEAD_LETTER_RETENTION_DAYS,
} from '@/lib/integrations/github/dead-letter-retention'
import {
  DEFAULT_SCAN_EVIDENCE_RETENTION_DAYS,
  SCAN_EVIDENCE_HARD_CAP_DAYS,
  SCAN_EVIDENCE_RETENTION_DAYS,
} from '@/lib/security-scan/evidence-retention'
import { EXPORT_TTL_DAYS } from '@/lib/workspace/export-ttl'
import { PUBLIC_ROUTES } from '@/proxy'
import { generateMetadata } from '@/app/security/page'

/** Intl.ListFormat (ES2021) — absent from the repo's TS lib, present in Node. */
function orList(locale: string, items: string[]): string {
  const { ListFormat } = Intl as unknown as {
    ListFormat: new (
      locale: string,
      opts: { type: 'disjunction' }
    ) => { format: (items: string[]) => string }
  }
  return new ListFormat(locale, { type: 'disjunction' }).format(items)
}

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
    formatNumber: (value: number) =>
      new Intl.NumberFormat(locale).format(value),
    formatList: (items: string[], opts: { type: 'disjunction' }) => {
      const { ListFormat } = Intl as unknown as {
        ListFormat: new (
          l: string,
          o: { type: 'disjunction' }
        ) => { format: (i: string[]) => string }
      }
      return new ListFormat(locale, opts).format(items)
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
  'security.retention.heading',
  'security.subprocessors.heading',
  'security.report.heading',
]

/** Locales written in English — the only ones allowed to reuse en wording. */
const ENGLISH = new Set<PublicLocale>(['en', 'en-GB', 'en-AU'])

function render(locale: PublicLocale): string {
  return renderToStaticMarkup(
    <IntlProviderWrapper locale={locale}>
      <SecurityPage locale={locale} retentionFigures={RETENTION_FIGURES} />
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

  it('security retention copy quotes figures from the retention constants', () => {
    // LUM-915: every figure the retention section states is an ICU value
    // bound to a lib constant, so no locale can carry a stale number.
    const retentionKeys = Object.keys(MESSAGES.en!).filter(k =>
      k.startsWith('security.retention.')
    )
    expect(retentionKeys.length).toBeGreaterThan(0)
    const placeholders = (v: string) =>
      [...v.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()
    // The one literal figure: the zero-retention scan tier.
    expect(SCAN_EVIDENCE_RETENTION_DAYS).toContain(0)

    const problems: string[] = []
    for (const locale of PUBLIC_LOCALES) {
      const messages = MESSAGES[locale]!
      for (const key of [...retentionKeys, 'security.code.hookEvents']) {
        const value = messages[key] ?? ''
        if (
          JSON.stringify(placeholders(value)) !==
          JSON.stringify(placeholders(MESSAGES.en![key]!))
        )
          problems.push(`${locale}: ${key} placeholders differ from en`)
        const literal = value
          .replace(/\{\w+\}/g, '')
          .replace(/SHA-256/g, '')
          .replace(key === 'security.retention.scan' ? /\b0\b/ : /$^/, '')
        if (/\d/.test(literal))
          problems.push(`${locale}: ${key} hard-codes a number`)
      }
      const page = text(render(locale))
      if (/\{\w+\}/.test(page))
        problems.push(`${locale}: unfilled placeholder rendered`)
      const tiers = orList(locale, HOOK_EVENT_RETENTION_DAYS.map(String))
      if (!page.includes(tiers))
        problems.push(`${locale}: session tiers "${tiers}" not rendered`)
    }
    expect(problems).toEqual([])

    const en = text(render('en'))
    const or = (days: readonly number[]) => orList('en', days.map(String))
    for (const claim of [
      `content cleared ${or(HOOK_EVENT_RETENTION_DAYS)} days after each event`,
      `(up to ${new Intl.NumberFormat('en').format(FAILURE_ERROR_CAP)} characters)`,
      `discarded ${USED_UP_GRACE_DAYS} days after it is used up`,
      `after ${USED_UP_IDLE_DAYS} days with no agent activity`,
      `up to ${USED_UP_AUDIT_WAIT_CAP_DAYS} days after completion`,
      `cleared ${DEFAULT_SCAN_EVIDENCE_RETENTION_DAYS} days after the pull request is merged or closed`,
      `choose ${or(SCAN_EVIDENCE_RETENTION_DAYS)} days`,
      `cleared ${SCAN_EVIDENCE_HARD_CAP_DAYS} days after that scan finished`,
      `without code ${DEFAULT_CROSSING_RAW_RETENTION_DAYS} days after the crossing is dispositioned`,
      `choose ${or(CROSSING_RAW_RETENTION_DAYS)} days`,
      `removed ${DEAD_LETTER_PAYLOAD_RETENTION_DAYS} days after the failure`,
      `choose ${or(DEAD_LETTER_RETENTION_DAYS)} days`,
    ])
      expect(en).toContain(claim)
  })

  it('security page states shipped retention defaults and no unshipped controls', () => {
    const en = MESSAGES.en!
    // LUM-933: session records keep code by default; credentials are
    // redacted in every mode.
    expect(en['security.code.hookEvents']).not.toMatch(/but not your code/)
    expect(en['security.code.hookEvents']).toMatch(/code included/)
    expect(en['security.code.hookEvents']).toMatch(
      /redacted before it is stored, whatever the retention setting/
    )
    expect(en['security.retention.session']).toMatch(
      /kept for as long as the workspace exists, by default/
    )
    // Storage relies on the providers' at-rest encryption: nothing in the
    // session-record or retention copy may suggest Lumo-side encryption or
    // per-workspace keys (LUM-863 was declined).
    const retentionCopy = Object.entries(en)
      .filter(
        ([k]) =>
          k.startsWith('security.retention.') ||
          k === 'security.code.hookEvents'
      )
      .map(([, v]) => v)
      .join(' ')
    expect(retentionCopy).not.toMatch(/encrypt|crypto|shred|key/i)
    expect(en['security.notYet.body']).toMatch(
      /encryption with a separate key for each workspace/
    )
    // LUM-917 is not shipped: AI-derived content is only said to be kept.
    expect(en['security.retention.derived']).toMatch(
      /kept for as long as the workspace exists/
    )
    expect(en['security.retention.derived']).not.toMatch(
      /turn off|switch off|disable|delete/i
    )
    // LUM-860: uninstall and repository removal both clear scan code.
    expect(en['security.retention.uninstall']).toMatch(
      /or removing a repository from it, clears the code/
    )
    expect(en['security.code.retention']).toBeUndefined()
    expect(en['security.code.uninstall']).toBeUndefined()
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
