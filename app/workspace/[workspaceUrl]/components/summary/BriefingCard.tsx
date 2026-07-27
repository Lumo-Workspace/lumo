'use client'

import { useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import { parseReport } from '@/lib/summaries/parse-report'
import { RichReportContent } from './RichReportContent'
import type { WorkspaceMemberInfo } from '../../types'
import type { AgentActor } from '../../hooks/useMembers'

interface BriefingCardProps {
  tldr: string
  report: string
  generatedAt: string
  members?: WorkspaceMemberInfo[]
  agentActors?: AgentActor[]
}

export function BriefingCard({
  tldr,
  report,
  generatedAt,
  members = [],
  agentActors = [],
}: BriefingCardProps) {
  const intl = useIntl()
  const [expanded, setExpanded] = useState(false)

  const parsed = useMemo(
    () => parseReport(report, intl.locale),
    [report, intl.locale]
  )

  const hasStructured = parsed.todayFocus.length > 0

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
    <div className='rounded-lg border border-border p-4 space-y-3'>
      {formattedDate && (
        <header className='flex items-center justify-end'>
          <span className='text-xs text-muted-foreground'>{formattedDate}</span>
        </header>
      )}

      {tldr ? (
        <p className='text-base font-medium text-foreground'>{tldr}</p>
      ) : (
        <p className='text-sm text-muted-foreground italic'>
          {intl.formatMessage({
            id: 'summary.noReport',
            defaultMessage:
              'No report generated yet. Click "Refresh" to generate one.',
          })}
        </p>
      )}

      {hasStructured ? (
        <section>
          <h3 className='text-xs uppercase tracking-wider text-muted-foreground mb-2'>
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
            className='text-xs text-muted-foreground hover:text-foreground'
          >
            {expanded
              ? intl.formatMessage({ id: 'summary.hideFullReport' })
              : intl.formatMessage({ id: 'summary.showFullReport' })}
          </button>
          {expanded && (
            <div className='border-t border-border pt-3'>
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
