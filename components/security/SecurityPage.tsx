'use client'

import Link from 'next/link'
import { useIntl } from 'react-intl'

import { AUDIT_RETENTION_DAYS } from '@/lib/audit/actions'
import type { PublicLocale } from '@/lib/i18n/public-locale'
import type { RetentionFigures } from '@/lib/legal/retention-figures'
import type { SubprocessorPageView } from '@/lib/legal/subprocessor-change-log'
import {
  SECURITY_CONTACT_EMAIL,
  SECURITY_PAGE_UPDATED,
} from '@/lib/legal/subprocessors'
import { LanguageSwitcher } from './LanguageSwitcher'
import { SubprocessorChanges } from './SubprocessorChanges'
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
      // LUM-945: the one AI path without zero data retention.
      'triage',
      'training',
      'openai',
      // LUM-871: providers may exclude models / features from ZDR and the
      // gateway does not fail those requests.
      'zdrExclusions',
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
      // LUM-1062: plugin paragraphs (the security plugin's 'scan') are
      // inserted from `retentionFigures.contributed`.
      'crossing',
      'deadLetter',
      'uninstall',
      'derived',
      'derivedDelete',
      'backlog',
    ],
  },
  // LUM-907: what the workspace audit log records, how long, who sees it.
  { id: 'audit', paragraphs: ['recorded', 'retention', 'access'] },
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
    commandCap: format.number(figures.commandCap),
    grace: figures.grace,
    idle: figures.idle,
    auditCap: figures.auditCap,
    crossingDefault: figures.crossingDefault,
    crossingTiers: tiers(figures.crossingTiers),
    deadLetterDefault: figures.deadLetterDefault,
    deadLetterTiers: tiers(figures.deadLetterTiers),
    // LUM-1062: each contributed paragraph's own figures.
    ...Object.fromEntries(
      figures.contributed.flatMap(c =>
        Object.entries(c.values).map(([key, value]) => [
          key,
          typeof value === 'number' ? value : tiers(value),
        ])
      )
    ),
  }
}

/**
 * LUM-1062 — a section's paragraph keys with the plugin paragraphs placed
 * right after the core paragraph each one names (only the retention
 * section takes contributions).
 */
function sectionParagraphs(
  section: { id: string; paragraphs: string[] },
  figures: RetentionFigures
): string[] {
  if (section.id !== 'retention') return section.paragraphs
  return section.paragraphs.flatMap(p => [
    p,
    ...figures.contributed.filter(c => c.after === p).map(c => c.paragraph),
  ])
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
      <h2 id={`${id}-heading`} className='mb-4 text-heading'>
        {title}
      </h2>
      <div className='space-y-3 leading-relaxed'>{children}</div>
    </section>
  )
}

interface SecurityPageProps {
  locale: PublicLocale
  retentionFigures: RetentionFigures
  /** What is in use, upcoming and recently changed, at request time (LUM-919). */
  subprocessors: SubprocessorPageView
}

export function SecurityPage({
  locale,
  retentionFigures,
  subprocessors,
}: SecurityPageProps) {
  const intl = useIntl()
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id }, values)
  const rich = (id: string, values: Record<string, React.ReactNode>) =>
    intl.formatMessage({ id }, values)
  const retention = retentionValues(retentionFigures, {
    orList: items => intl.formatList(items, { type: 'disjunction' }),
    number: value => intl.formatNumber(value),
  })
  // Each section's ICU values; the audit retention comes from the constant
  // the daily prune uses (LUM-907).
  const sectionValues: Record<string, Record<string, string | number>> = {
    retention,
    audit: { days: AUDIT_RETENTION_DAYS },
  }
  const updated = intl.formatDate(`${SECURITY_PAGE_UPDATED}T00:00:00Z`, {
    dateStyle: 'long',
    timeZone: 'UTC',
  })

  return (
    <main lang={locale} className='min-h-screen bg-background text-foreground'>
      <div className='mx-auto max-w-3xl px-4 py-10 sm:px-8 sm:py-16'>
        <header className='flex flex-wrap items-center justify-between gap-4'>
          <Link href='/' className='text-title'>
            Lumo
          </Link>
          <LanguageSwitcher locale={locale} path='/security' />
        </header>

        <h1 className='mt-10 text-display'>{t('security.title')}</h1>
        <p className='mt-2 text-body text-muted-foreground'>
          {t('security.updated', { date: updated })}
        </p>
        <p className='mt-6 leading-relaxed'>{t('security.intro')}</p>

        {SECTIONS.map(section => (
          <Section
            key={section.id}
            id={section.id}
            title={t(`security.${section.id}.heading`)}
          >
            {sectionParagraphs(section, retentionFigures).map(p => (
              <p key={p}>
                {t(`security.${section.id}.${p}`, sectionValues[section.id])}
              </p>
            ))}
          </Section>
        ))}

        <Section id='subprocessors' title={t('security.subprocessors.heading')}>
          <p>{t('security.subprocessors.intro')}</p>
          <SubprocessorTables
            infrastructure={subprocessors.infrastructure}
            aiHosts={subprocessors.aiHosts}
          />
          <SubprocessorChanges
            pending={subprocessors.pending}
            recent={subprocessors.recent}
          />
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
                  className='font-mono text-body underline underline-offset-4'
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
