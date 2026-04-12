'use client'

import { useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import type { RiskAssessment } from '@/types/summary'
import { parseReport } from '@/lib/summaries/parse-report'
import { RiskBadge } from './RiskBadge'
import { RichReportContent } from './RichReportContent'
import type { WorkspaceMemberInfo } from '../../types'
import type { AgentActor } from '../../hooks/useMembers'

interface BriefingCardProps {
  tldr: string
  report: string
  generatedAt: string
  risk: RiskAssessment | null
  members?: WorkspaceMemberInfo[]
  agentActors?: AgentActor[]
}

export function BriefingCard({
  tldr,
  report,
  generatedAt,
  risk,
  members = [],
  agentActors = [],
}: BriefingCardProps) {
  const intl = useIntl()
  const [expanded, setExpanded] = useState(false)

  const parsed = useMemo(
    () => parseReport(report, intl.locale),
    [report, intl.locale]
  )

  const hasStructured =
    parsed.todayFocus.length > 0 || parsed.riskNarrative.length > 0

  const parsedDate = generatedAt ? new Date(generatedAt) : null
  const formattedDate =
    parsedDate && !isNaN(parsedDate.getTime())
      ? parsedDate.toLocaleDateString(intl.locale, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : null

  return (
    <div className='rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 space-y-3'>
      <header className='flex items-center justify-between'>
        <RiskBadge level={risk?.level ?? null} showLabel />
        {formattedDate && (
          <span className='text-xs text-zinc-400 dark:text-zinc-500'>
            {formattedDate}
          </span>
        )}
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
                  <RichReportContent
                    key={i}
                    markdown={`- ${item}`}
                    members={members}
                    agentActors={agentActors}
                    className='contents'
                  />
                ))}
              </ul>
            </section>
          )}

          {parsed.riskNarrative && (
            <section className='rounded bg-zinc-50 dark:bg-zinc-900/50 p-3 text-xs text-zinc-600 dark:text-zinc-400'>
              <RichReportContent
                markdown={parsed.riskNarrative}
                members={members}
                agentActors={agentActors}
                className='space-y-1'
              />
            </section>
          )}
        </>
      ) : (
        <RichReportContent
          markdown={parsed.raw}
          members={members}
          agentActors={agentActors}
        />
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
            <div className='border-t border-zinc-100 dark:border-zinc-800 pt-3'>
              <RichReportContent
                markdown={parsed.raw}
                members={members}
                agentActors={agentActors}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
