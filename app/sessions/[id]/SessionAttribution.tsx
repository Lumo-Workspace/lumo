'use client'

import { useIntl } from 'react-intl'
import type { SessionAttributionView } from '@/lib/services/session-list.service'
import {
  APPROXIMATE_NOTICE,
  CONFIDENCE_MESSAGES,
  SIGNAL_MESSAGES,
  SOURCE_MESSAGES,
  SUBAGENT_UNKNOWN_TYPE,
  TURN_MESSAGE,
  TURNS_MESSAGE,
} from '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/attribution-labels'
import { SESSION_MESSAGES as M } from '../messages'

interface SessionAttributionProps {
  view: SessionAttributionView
}

export function SessionAttribution({ view }: SessionAttributionProps) {
  const intl = useIntl()

  return (
    <section
      data-testid='session-attribution'
      className='mb-8 rounded-md border p-4'
    >
      <h2 className='mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground'>
        {intl.formatMessage(M['attribution.title'])}
      </h2>

      {view.approximate && (
        <p
          data-testid='session-attribution-approximate'
          className='mb-3 rounded-sm border border-border px-3 py-2 text-xs text-amber-700 dark:text-amber-400'
        >
          {intl.formatMessage(APPROXIMATE_NOTICE)}
        </p>
      )}

      {view.unattributed && (
        <p className='mb-3 text-sm text-muted-foreground'>
          {intl.formatMessage(M['attribution.unattributed'])}
        </p>
      )}

      {view.segments.length > 0 && (
        <ul className='mb-3 space-y-2 text-sm'>
          {view.segments.map((seg, i) => (
            <li
              key={`${seg.taskIdentifier}-${seg.fromTurn}-${i}`}
              data-testid='session-attribution-segment'
            >
              <div>
                <span className='font-mono text-xs'>{seg.taskIdentifier}</span>
                {' · '}
                {seg.fromTurn === seg.toTurn
                  ? intl.formatMessage(TURN_MESSAGE, { n: seg.fromTurn + 1 })
                  : intl.formatMessage(TURNS_MESSAGE, {
                      fromN: seg.fromTurn + 1,
                      toN: seg.toTurn + 1,
                    })}
                {' · '}
                {intl.formatMessage(SOURCE_MESSAGES[seg.source])}
                {' · '}
                {intl.formatMessage(CONFIDENCE_MESSAGES[seg.confidence])}
              </div>
              {seg.evidence.map((e, j) => (
                <div
                  key={`${e.kind}-${e.identifier}-${j}`}
                  className='pl-3 text-xs text-muted-foreground'
                >
                  {intl.formatMessage(SIGNAL_MESSAGES[e.kind])} · {e.identifier}
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}

      {view.subagents.length > 0 && (
        <div>
          <h3 className='mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
            {intl.formatMessage(M['attribution.subagents'])}
          </h3>
          <ul className='space-y-1 text-sm'>
            {view.subagents.map(sub => (
              <li
                key={sub.sessionId}
                data-testid='session-attribution-subagent'
              >
                <span>
                  {sub.agentType ?? intl.formatMessage(SUBAGENT_UNKNOWN_TYPE)}
                </span>
                {' · '}
                {sub.tasks.length === 0 ? (
                  <span className='text-muted-foreground'>
                    {intl.formatMessage(M['attribution.subagentNoTask'])}
                  </span>
                ) : (
                  sub.tasks.map((t, i) => (
                    <span key={`${t.taskIdentifier}-${i}`}>
                      {i > 0 && ', '}
                      <span className='font-mono text-xs'>
                        {t.taskIdentifier}
                      </span>
                      {' ('}
                      {intl.formatMessage(SOURCE_MESSAGES[t.source])}
                      {' · '}
                      {intl.formatMessage(CONFIDENCE_MESSAGES[t.confidence])}
                      {')'}
                    </span>
                  ))
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
