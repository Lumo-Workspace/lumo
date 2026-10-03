'use client'

import Link from 'next/link'
import { useIntl } from 'react-intl'

import type { PublicLocale } from '@/lib/i18n/public-locale'
import type { RetentionFigures } from '@/lib/legal/retention-figures'
import {
  SECURITY_CONTACT_EMAIL,
  SECURITY_PAGE_UPDATED,
} from '@/lib/legal/subprocessors'
import { LanguageSwitcher } from './LanguageSwitcher'
import { SubprocessorTables } from './SubprocessorTables'

const SECURITY_TXT_PATH = '/.well-known/security.txt'

/** Section id → the paragraph keys it renders, in order. */
const SECTIONS: { id: string; paragraphs: string[] }[] = [
  {
    id: 'infra',
    paragraphs: ['hosting', 'transit', 'atRest', 'tokens', 'sandbox'],
  },
  { id: 'auth', paragraphs: ['signin', 'roles', 'apiKeys'] },
  {
    id: 'code',
    paragraphs: [
      'ai',
      'training',
      'openai',
      'openWeights',
      'region',
      'hookEvents',
      'export',
      'deletion',
    ],
  },
  {
    id: 'retention',
    paragraphs: [
      'intro',
      'session',
      'usedUp',
      'tighten',
      'scan',
      'crossing',
      'deadLetter',
      'uninstall',
      'derived',
      'backlog',
    ],
  },
  { id: 'notYet', paragraphs: ['body'] },
]

/**
 * LUM-915 — the retention paragraphs' ICU values. The figures come from the
 * constants the settings rows and the cleanup sweeps use (passed in from the
 * server page), so the copy cannot drift from the shipped behaviour. Tier
 * lists are joined with the locale's own "or" list format, and the error cap
 * is grouped the locale's way (2,000 / 2.000 / 2 000).
 */
function retentionValues(
  figures: RetentionFigures,
  format: {
    orList: (items: string[]) => string
    number: (value: number) => string
  }
): Record<string, string | number> {
  const tiers = (days: readonly number[]) => format.orList(days.map(String))
  return {
    sessionDays: tiers(figures.sessionDays),
    errorCap: format.number(figures.errorCap),
    grace: figures.grace,
    idle: figures.idle,
    auditCap: figures.auditCap,
    scanDefault: figures.scanDefault,
    scanTiers: tiers(figures.scanTiers),
    openCap: figures.openCap,
    crossingDefault: figures.crossingDefault,
    crossingTiers: tiers(figures.crossingTiers),
    deadLetterDefault: figures.deadLetterDefault,
    deadLetterTiers: tiers(figures.deadLetterTiers),
  }
}

function Section({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className='mt-12'>
      <h2 id={`${id}-heading`} className='mb-4 text-xl font-semibold'>
        {title}
      </h2>
      <div className='space-y-3 leading-relaxed'>{children}</div>
    </section>
  )
}

interface SecurityPageProps {
  locale: PublicLocale
  retentionFigures: RetentionFigures
}

export function SecurityPage({ locale, retentionFigures }: SecurityPageProps) {
  const intl = useIntl()
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id }, values)
  const rich = (id: string, values: Record<string, React.ReactNode>) =>
    intl.formatMessage({ id }, values)
  const retention = retentionValues(retentionFigures, {
    orList: items => intl.formatList(items, { type: 'disjunction' }),
    number: value => intl.formatNumber(value),
  })
  const updated = intl.formatDate(`${SECURITY_PAGE_UPDATED}T00:00:00Z`, {
    dateStyle: 'long',
    timeZone: 'UTC',
  })

  return (
    <main lang={locale} className='min-h-screen bg-background text-foreground'>
      <div className='mx-auto max-w-3xl px-4 py-10 sm:px-8 sm:py-16'>
        <header className='flex flex-wrap items-center justify-between gap-4'>
          <Link href='/' className='text-lg font-semibold'>
            Lumo
          </Link>
          <LanguageSwitcher locale={locale} path='/security' />
        </header>

        <h1 className='mt-10 text-3xl font-bold'>{t('security.title')}</h1>
        <p className='mt-2 text-sm text-muted-foreground'>
          {t('security.updated', { date: updated })}
        </p>
        <p className='mt-6 leading-relaxed'>{t('security.intro')}</p>

        {SECTIONS.map(section => (
          <Section
            key={section.id}
            id={section.id}
            title={t(`security.${section.id}.heading`)}
          >
            {section.paragraphs.map(p => (
              <p key={p}>
                {t(
                  `security.${section.id}.${p}`,
                  section.id === 'retention' ? retention : undefined
                )}
              </p>
            ))}
          </Section>
        ))}

        <Section id='subprocessors' title={t('security.subprocessors.heading')}>
          <p>{t('security.subprocessors.intro')}</p>
          <SubprocessorTables />
        </Section>

        <Section id='report' title={t('security.report.heading')}>
          <p>
            {rich('security.report.body', {
              email: (
                <a
                  className='font-medium underline underline-offset-4'
                  href={`mailto:${SECURITY_CONTACT_EMAIL}`}
                >
                  {SECURITY_CONTACT_EMAIL}
                </a>
              ),
            })}
          </p>
          <p>
            {rich('security.report.securityTxt', {
              path: (
                <a
                  className='font-mono text-sm underline underline-offset-4'
                  href={SECURITY_TXT_PATH}
                >
                  {SECURITY_TXT_PATH}
                </a>
              ),
            })}
          </p>
        </Section>
      </div>
    </main>
  )
}
