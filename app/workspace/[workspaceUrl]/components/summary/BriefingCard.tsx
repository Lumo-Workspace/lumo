'use client'

import { useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import type { RiskAssessment } from '@/types/summary'
import { parseReport } from '@/lib/summaries/parse-report'
import { RiskBadge } from './RiskBadge'

interface BriefingCardProps {
  tldr: string
  report: string
  generatedAt: string
  risk: RiskAssessment | null
}

export function BriefingCard({
  tldr,
  report,
  generatedAt,
  risk,
}: BriefingCardProps) {
  const intl = useIntl()
  const [expanded, setExpanded] = useState(false)

  const parsed = useMemo(
    () => parseReport(report, intl.locale),
    [report, intl.locale]
  )

  const hasStructured =
    parsed.todayFocus.length > 0 || parsed.riskNarrative.length > 0

  const formattedDate = new Date(generatedAt).toLocaleDateString(intl.locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div className='rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 space-y-3'>
      <header className='flex items-center justify-between'>
        <RiskBadge level={risk?.level ?? null} showLabel />
        <span className='text-xs text-zinc-400 dark:text-zinc-500'>
          {formattedDate}
        </span>
      </header>

      <p className='text-base font-medium text-zinc-800 dark:text-zinc-200'>
        {tldr}
      </p>

      {hasStructured ? (
        <>
          {parsed.todayFocus.length > 0 && (
            <section>
              <h3 className='text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2'>
                {intl.formatMessage({ id: 'summary.todayFocus' })}
              </h3>
              <ul className='space-y-1.5'>
                {parsed.todayFocus.map((item, i) => (
                  <li
                    key={i}
                    className='flex gap-2 text-sm text-zinc-700 dark:text-zinc-300'
                  >
                    <span className='text-zinc-400'>•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {parsed.riskNarrative && (
            <section className='rounded bg-zinc-50 dark:bg-zinc-900/50 p-3 text-xs text-zinc-600 dark:text-zinc-400'>
              {parsed.riskNarrative}
            </section>
          )}
        </>
      ) : (
        <pre className='whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300 font-sans'>
          {parsed.raw}
        </pre>
      )}

      {hasStructured && (
        <>
          <button
            type='button'
            onClick={() => setExpanded(v => !v)}
            className='text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
          >
            {expanded
              ? intl.formatMessage({ id: 'summary.hideFullReport' })
              : intl.formatMessage({ id: 'summary.showFullReport' })}
          </button>
          {expanded && (
            <pre className='whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-400 border-t border-zinc-100 dark:border-zinc-800 pt-3 font-sans'>
              {parsed.raw}
            </pre>
          )}
        </>
      )}
    </div>
  )
}
