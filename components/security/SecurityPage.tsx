'use client'

import Link from 'next/link'
import { useIntl } from 'react-intl'

import type { PublicLocale } from '@/lib/i18n/public-locale'
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
      'retention',
      'uninstall',
      'deletion',
    ],
  },
  { id: 'notYet', paragraphs: ['body'] },
]

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
}

export function SecurityPage({ locale }: SecurityPageProps) {
  const intl = useIntl()
  const t = (id: string, values?: Record<string, string>) =>
    intl.formatMessage({ id }, values)
  const rich = (id: string, values: Record<string, React.ReactNode>) =>
    intl.formatMessage({ id }, values)
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
              <p key={p}>{t(`security.${section.id}.${p}`)}</p>
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
