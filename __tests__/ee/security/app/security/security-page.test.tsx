/**
 * @jest-environment node
 */
/**
 * LUM-1064: plugin half of __tests__/app/security/security-page.test.tsx (split)
 */

import { renderToStaticMarkup } from 'react-dom/server'

import { SecurityPage } from '@/components/security/SecurityPage'
import { IntlProviderWrapper } from '@/lib/i18n/IntlProviderWrapper'
import { MESSAGES } from '@/lib/i18n/messages'
import { PUBLIC_LOCALES, type PublicLocale } from '@/lib/i18n/public-locale'
import {
  AI_HOST_SUBPROCESSORS,
  INFRASTRUCTURE_SUBPROCESSORS,
} from '@/lib/legal/subprocessors'
import {
  CORE_RETENTION_FIGURES,
  retentionFigures,
} from '@/lib/legal/retention-figures'
import {
  buildSubprocessorPageView,
  type SubprocessorPageView,
} from '@/lib/legal/subprocessor-change-log'
import {
  HOOK_EVENT_RETENTION_DAYS,
  USED_UP_AUDIT_WAIT_CAP_DAYS,
  USED_UP_GRACE_DAYS,
  USED_UP_IDLE_DAYS,
} from '@/lib/hook-event/retention'
import {
  COMMAND_SUMMARY_CAP,
  FAILURE_ERROR_CAP,
} from '@/lib/hook-payload/redact'
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
} from '@/ee/security/security-scan/evidence-retention'

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

describe('/security page (LUM-856)', () => {
  it('LUM-1062 the scan evidence paragraph comes from the security plugin, after the tighten paragraph', () => {
    const scanLead = 'Security scan evidence ('
    const withPlugin = text(render('en'))
    const at = (needle: string) => withPlugin.indexOf(needle)
    expect(at(scanLead)).toBeGreaterThan(
      at('A stricter session record setting')
    )
    expect(at(scanLead)).toBeLessThan(at('The original command, diff line'))

    // No plugin (the OSS snapshot): no scan paragraph, nothing unfilled.
    const bare = text(
      render('en', NO_CHANGES, { ...CORE_RETENTION_FIGURES, contributed: [] })
    )
    expect(bare).not.toContain(scanLead)
    expect(bare).not.toMatch(/\{\w+\}/)
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
      `commands (heredoc bodies removed, up to ${new Intl.NumberFormat('en').format(COMMAND_SUMMARY_CAP)} characters)`,
      'prompts and agent messages with any code removed',
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
})
