/**
 * @jest-environment node
 */

// clerkMiddleware() checks for keys at import time (see proxy.matcher.test.ts).
process.env.CLERK_SECRET_KEY = 'sk_test_dummy'
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_dummy'

// LUM-1064: plugin cases live in __tests__/ee/security/app/security/security-page.test.tsx.
// LUM-1064: core test, run without the security plugin (the OSS build).
jest.mock('@/lib/plugins/installed', () => ({ INSTALLED_SERVER_PLUGINS: [] }))

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
import { retentionFigures } from '@/lib/legal/retention-figures'
import {
  buildSubprocessorPageView,
  type SubprocessorPageView,
} from '@/lib/legal/subprocessor-change-log'
import {
  NOTICE_PERIOD_DAYS,
  PRIVACY_CONTACT_EMAIL,
  type SubprocessorChange,
} from '@/lib/legal/subprocessor-changes'
import { EXPORT_TTL_DAYS } from '@/lib/workspace/export-ttl'
import { AUDIT_RETENTION_DAYS } from '@/lib/audit/actions'
import { PUBLIC_ROUTES } from '@/proxy'
import { generateMetadata } from '@/app/security/page'
import { aiDerivedContentRepository } from '@/lib/repositories/ai-derived-content.repository'
import { aiDerivedContentService } from '@/lib/services/ai-derived-content.service'

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

// LUM-917: the AI-derived content delete is driven through the real service
// against a mocked repository, so the copy's delete list is held to the
// batches the service actually runs.
jest.mock('@/lib/repositories/ai-derived-content.repository', () => ({
  aiDerivedContentRepository: {
    findEnabled: jest.fn(),
    countForWorkspace: jest.fn(),
    deleteMemoryBatch: jest.fn(),
    clearSessionSummaryBatch: jest.fn(),
    clearRunSummaryBatch: jest.fn(),
    clearClaimSnapshotBatch: jest.fn(),
    clearVerdictTextBatch: jest.fn(),
  },
}))

const SECTION_HEADINGS = [
  'security.infra.heading',
  'security.auth.heading',
  'security.code.heading',
  'security.retention.heading',
  'security.audit.heading',
  'security.subprocessors.heading',
  'security.report.heading',
]

/** Locales written in English — the only ones allowed to reuse en wording. */
const ENGLISH = new Set<PublicLocale>(['en', 'en-GB', 'en-AU'])

/** The shipped registry with no change in flight. */
const NO_CHANGES: SubprocessorPageView = buildSubprocessorPageView({
  infrastructure: INFRASTRUCTURE_SUBPROCESSORS,
  aiHosts: AI_HOST_SUBPROCESSORS,
  changes: [],
  now: new Date('2026-10-05T00:00:00Z'),
})

function render(
  locale: PublicLocale,
  subprocessors: SubprocessorPageView = NO_CHANGES,
  figures = retentionFigures()
): string {
  return renderToStaticMarkup(
    <IntlProviderWrapper locale={locale}>
      <SecurityPage
        locale={locale}
        retentionFigures={figures}
        subprocessors={subprocessors}
      />
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
    // LUM-942 removed acceptance criteria; EXPORT_KINDS has no such kind.
    expect(MESSAGES.en!['security.code.export']).not.toMatch(/criteria/i)
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
    // sentence, and the zh locales name sprints as the sidebar does.
    const problems: string[] = []
    for (const locale of PUBLIC_LOCALES) {
      const exportText = MESSAGES[locale]!['security.code.export'] ?? ''
      if (!locale.startsWith('en') && exportText.includes('uploaded files'))
        problems.push(`${locale}: English fallback`)
    }
    for (const locale of ['zh-CN', 'zh-TW']) {
      const messages = MESSAGES[locale]!
      const exportText = messages['security.code.export'] ?? ''
      for (const key of ['sidebar.sprints']) {
        const term = messages[key] ?? ''
        if (!term || !exportText.includes(term))
          problems.push(`${locale}: export copy does not use ${key} "${term}"`)
      }
    }
    expect(problems).toEqual([])
  })

  // LUM-1064: with no plugin installed (the OSS snapshot) the default render
  // carries no scan-evidence paragraph and leaves no ICU value unfilled.
  it('without a plugin, renders the retention section with no scan paragraph', () => {
    expect(retentionFigures().contributed).toEqual([])
    for (const locale of PUBLIC_LOCALES) {
      const page = text(render(locale))
      expect(page).not.toMatch(/\{\w+\}/)
      expect(page).toContain(MESSAGES[locale]!['security.retention.heading'])
    }
    expect(text(render('en'))).not.toContain('Security scan evidence (')
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
    // LUM-860's uninstall paragraph is plugin copy (scan code) the
    // open-source snapshot drops; it is checked in
    // __tests__/ee/security/landing/hosted-copy-lum1081.test.tsx (LUM-1081).
    expect(en['security.code.retention']).toBeUndefined()
    expect(en['security.code.uninstall']).toBeUndefined()
  })

  it('security AI-derived content copy matches the shipped switch and delete LUM-917', async () => {
    const en = MESSAGES.en!
    const derived = en['security.retention.derived'] as string
    const del = en['security.retention.derivedDelete'] as string
    const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')

    // Default on: workspaces.aiDerivedContentEnabled defaults to true.
    expect(read('prisma/schema.prisma')).toMatch(
      /aiDerivedContentEnabled Boolean @default\(true\)/
    )
    expect(derived).toMatch(/This is on by default\./)

    // Code stripped, then credentials redacted, on every derived write.
    for (const repo of [
      'lib/repositories/memory.repository.ts',
      'lib/repositories/session.repository.ts',
    ])
      expect(read(repo)).toMatch(
        /redactStoredFields\(stripCodeFromStoredFields\(data, fields\), fields\)/
      )
    expect(read('lib/repositories/hook-event.repository.ts')).toMatch(
      /redactForStorage\(stripCodeFromText\(summary\)\.text\)/
    )
    expect(derived).toContain(
      'code blocks and lines of code are removed and credentials are redacted'
    )
    expect(derived).toContain(
      'Each turn in a session record still gets a one-line summary, also stored without code'
    )

    // OWNER only: the switch (workspace settings) and the delete.
    await expect(
      aiDerivedContentService.purge(
        { id: 'w1', name: 'Acme' },
        'MEMBER',
        'Acme'
      )
    ).rejects.toMatchObject({ status: 403 })
    expect(read('lib/services/workspace.service.ts')).toMatch(
      /aiDerivedContentEnabled !== undefined/
    )
    expect(derived).toMatch(/An owner can turn it off under Data retention/)
    expect(derived).toMatch(/no new memories or summaries are generated/)
    expect(derived).toMatch(/no AI-written task claim/)
    expect(derived).toMatch(/an agent's own report on its work is still kept/)
    expect(derived).toMatch(
      /kept for as long as the workspace exists unless an owner deletes it/
    )

    // Delete: re-typed name, then exactly the batches the copy names.
    const repo = aiDerivedContentRepository as unknown as Record<
      string,
      jest.Mock
    >
    const NAMED: Record<string, string> = {
      'every memory in the workspace, including memories added by hand, together with its search embedding':
        'deleteMemoryBatch',
      'session summaries': 'clearSessionSummaryBatch',
      'run summaries': 'clearRunSummaryBatch',
      'the task claims generated from them': 'clearClaimSnapshotBatch',
      'the explanations written for claim faithfulness checks':
        'clearVerdictTextBatch',
    }
    for (const fn of Object.values(NAMED))
      repo[fn]!.mockReset().mockResolvedValue(0)
    await expect(
      aiDerivedContentService.purge({ id: 'w1', name: 'Acme' }, 'OWNER', 'acme')
    ).rejects.toMatchObject({ status: 400 })
    for (const fn of Object.values(NAMED))
      expect(repo[fn]).not.toHaveBeenCalled()
    expect(del).toContain('after re-typing the workspace name')

    const result = await aiDerivedContentService.purge(
      { id: 'w1', name: 'Acme' },
      'OWNER',
      'Acme'
    )
    expect(result.done).toBe(true)
    for (const [phrase, fn] of Object.entries(NAMED)) {
      expect(del).toContain(phrase)
      expect(repo[fn]).toHaveBeenCalledWith('w1', expect.any(Number))
    }
    // The embedding lives on the memory row the batch deletes.
    expect(read('prisma/schema.prisma')).toMatch(
      /embedding\s+Unsupported\("vector\(1024\)"\)\?/
    )
    // Not affected: the delete never touches hook events or documents.
    const repoSource = read('lib/repositories/ai-derived-content.repository.ts')
    expect(repoSource).not.toMatch(/prisma\.(hookEvent|document)\b/)
    expect(del).toContain(
      'session records, tasks and documents are not affected'
    )
    expect(del).toContain("An agent's own report on its work is kept")
  })

  it('security page discloses provider ZDR exclusions in every locale LUM-871', () => {
    // Vercel's ZDR doc: a provider can exclude specific models or features
    // from its ZDR policy and the gateway does not fail those requests, so
    // the "fails instead of falling back" sentence never stands alone.
    const en = MESSAGES.en!
    expect(en['security.code.ai']).toMatch(/fails instead of falling back/)
    expect(en['security.code.zdrExclusions']).toMatch(
      /exclude specific models or features/
    )
    expect(en['security.code.zdrExclusions']).toMatch(
      /does not fail such requests/
    )
    // The prompt-cache caveat is the exclusion that does apply to Lumo
    // (OpenAI data controls: encrypted KV cache, up to 24 hours).
    expect(en['security.code.zdrExclusions']).toMatch(/up to 24 hours/)

    const problems: string[] = []
    for (const locale of PUBLIC_LOCALES) {
      const messages = MESSAGES[locale]!
      const value = messages['security.code.zdrExclusions'] ?? ''
      if (!value) problems.push(`${locale}: key missing`)
      if (!value.includes('24')) problems.push(`${locale}: 24-hour cap missing`)
      if (!value.includes('Vercel')) problems.push(`${locale}: Vercel missing`)
      const page = text(render(locale))
      if (value && !page.includes(value))
        problems.push(`${locale}: paragraph not rendered`)
      // Rendered right after the OpenAI caveat, inside the code section.
      const openai = page.indexOf(messages['security.code.openai']!)
      if (openai < 0 || page.indexOf(value) < openai)
        problems.push(`${locale}: not after the OpenAI caveat`)
    }
    expect(problems).toEqual([])
  })

  it('security audit log section discloses what is recorded, retention and access LUM-907', () => {
    // PR2 of LUM-907: actor, IP, user agent and the invitee email are
    // recorded; kept AUDIT_RETENTION_DAYS; deleted with the workspace;
    // in the export; owners only.
    const en = MESSAGES.en!
    expect(en['security.audit.recorded']).toMatch(/IP address and user agent/)
    expect(en['security.audit.recorded']).toMatch(/invitee's email address/)
    expect(en['security.audit.retention']).toMatch(
      /deleted with the workspace|with the workspace when it is deleted/
    )
    expect(en['security.audit.retention']).toMatch(
      /included in the workspace export/
    )
    expect(en['security.audit.access']).toMatch(/Only workspace owners/)

    const problems: string[] = []
    for (const locale of PUBLIC_LOCALES) {
      const messages = MESSAGES[locale]!
      const page = text(render(locale))
      for (const p of ['recorded', 'access'] as const) {
        const value = messages[`security.audit.${p}`] ?? ''
        if (!value || !page.includes(value))
          problems.push(`${locale}: audit ${p} not rendered`)
      }
      const retention = (messages['security.audit.retention'] ?? '').replace(
        '{days}',
        String(AUDIT_RETENTION_DAYS)
      )
      if (!retention.includes(String(AUDIT_RETENTION_DAYS)))
        problems.push(`${locale}: retention days missing`)
      if (!page.includes(retention))
        problems.push(
          `${locale}: audit retention not rendered with the constant`
        )
      if (!messages['security.audit.recorded']?.includes('IP'))
        problems.push(`${locale}: IP not disclosed`)
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

  it('security page lists pending and recent subprocessor changes in every locale LUM-919', () => {
    const host = {
      gatewaySlug: 'examplehost',
      entity: 'Example Host, Inc.',
      location: 'globalRouting',
    } as const
    const calm = {
      gatewaySlug: 'calmhost',
      entity: 'Calm Host, Inc.',
      location: 'globalRouting',
    } as const
    const neon = INFRASTRUCTURE_SUBPROCESSORS.find(s => s.id === 'neon')!
    const changes: SubprocessorChange[] = [
      {
        id: '2026-09-01-neon-region',
        kind: 'changed',
        announcedAt: '2026-09-01',
        effectiveAt: '2026-10-01',
        summary: 'Neon region detail.',
        before: { list: 'infrastructure', entry: { ...neon, region: 'old' } },
        after: { list: 'infrastructure', entry: neon },
      },
      {
        id: '2026-10-05-example-host',
        kind: 'added',
        announcedAt: '2026-10-05',
        effectiveAt: '2026-10-20',
        urgent: { reason: 'n/a' },
        summary: 'Example Host joins.',
        after: { list: 'aiHost', entry: host },
      },
      // Marked urgent but announced with the full notice: no urgent label.
      {
        id: '2026-10-06-calm-host',
        kind: 'added',
        announcedAt: '2026-10-06',
        effectiveAt: '2026-11-05',
        urgent: { reason: 'n/a' },
        summary: 'Calm Host joins.',
        after: { list: 'aiHost', entry: calm },
      },
    ]
    const view = buildSubprocessorPageView({
      infrastructure: INFRASTRUCTURE_SUBPROCESSORS,
      aiHosts: [...AI_HOST_SUBPROCESSORS, host, calm],
      changes,
      now: new Date('2026-10-10T00:00:00Z'),
    })
    const problems: string[] = []
    for (const locale of PUBLIC_LOCALES) {
      const m = MESSAGES[locale]!
      const html = render(locale, view)
      // Each block runs from its own marker to the next one, so a string
      // found in one block cannot satisfy an assertion about another.
      const between = (from: string, to: string) => {
        const start = html.indexOf(from)
        const end = html.indexOf(to, start + 1)
        return start < 0 || end < 0 ? '' : text(html.slice(start, end))
      }
      const intro = between(
        'data-testid="subprocessor-changes"',
        'data-testid="subprocessor-changes-pending"'
      )
      const pending = between(
        'data-testid="subprocessor-changes-pending"',
        'data-testid="subprocessor-changes-recent"'
      )
      const recent = between(
        'data-testid="subprocessor-changes-recent"',
        'id="report"'
      )
      const tables = between(
        'data-testid="subprocessor-tables"',
        'data-testid="subprocessor-changes"'
      )
      const P = 'security.subprocessors.changes.'
      const need: [string, boolean][] = [
        ['heading', text(html).includes(m[`${P}heading`]!)],
        // The whole intro, with both values filled in.
        [
          'intro',
          m[`${P}intro`]!.replace('{days}', String(NOTICE_PERIOD_DAYS))
            .split('{email}')
            .every(part => intro.includes(part)) &&
            intro.includes(PRIVACY_CONTACT_EMAIL),
        ],
        ['summary shown', pending.includes('Example Host joins.')],
        ['pending name', pending.includes('Example Host, Inc.')],
        ['pending kind', pending.includes(m[`${P}kind.added`]!)],
        [
          'pending urgent once',
          pending.split(
            m[`${P}urgent`]!.replace('{days}', String(NOTICE_PERIOD_DAYS))
          ).length === 2,
        ],
        ['recent kind', recent.includes(m[`${P}kind.changed`]!)],
        ['recent name', recent.includes(neon.entity)],
        ['pending holds only pending', !pending.includes(neon.entity)],
        ['recent holds only recent', !recent.includes('Example Host, Inc.')],
        // Announced but not in effect: never shown as a subprocessor in use.
        ['not in use yet', !tables.includes('Example Host, Inc.')],
      ]
      for (const [what, ok] of need)
        if (!ok) problems.push(`${locale}: ${what}`)
    }
    expect(problems).toEqual([])
  })

  it('security page shows the empty change lists when nothing is in flight LUM-919', () => {
    const page = text(render('en'))
    expect(page).toContain(
      MESSAGES.en!['security.subprocessors.changes.pendingEmpty']
    )
    expect(page).toContain(
      MESSAGES.en!['security.subprocessors.changes.recentEmpty']
    )
    expect(render('en')).toContain('id="subprocessor-changes"')
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
