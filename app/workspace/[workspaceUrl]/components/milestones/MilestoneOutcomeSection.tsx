'use client'

import { useIntl } from 'react-intl'
import type { ApiMilestone } from '@/lib/api-client/milestones'

/** Claim provenance values the section knows how to label (LUM-597 layering). */
const KNOWN_SOURCES = new Set(['AGENT', 'RUN_SUMMARY', 'DIGEST'])

/** OutcomeSignalKind values with a label key; must track the Prisma enum. */
const KNOWN_KINDS = new Set([
  'REVERTED',
  'REOPENED',
  'ROLLED_BACK',
  'CI_REGRESSION',
  'DOWNSTREAM_REDIRECT',
  'BYPASSED',
  'MANUAL',
])

/**
 * LUM-626 — the Overview tab's outcome section: each DONE task's frozen claim
 * (hard results) plus the outcome well's post-delivery fate. Honest by
 * construction: a claim-less DONE task stays visible as an explicit no-claim
 * row; zero well signals read as "no rejection on record" (inconclusive) and
 * are never styled or worded as a pass. Hierarchy via typography, not color.
 */
export function MilestoneOutcomeSection({
  outcome,
}: {
  outcome: ApiMilestone['outcome']
}) {
  const intl = useIntl()
  if (!outcome) return null

  const { claims, fate } = outcome
  const empty = claims.length === 0 && fate.rejected.length === 0

  return (
    <section className='mt-10 max-w-3xl'>
      <p className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3'>
        {intl.formatMessage({ id: 'milestone.outcome.title' })}
      </p>

      {empty ? (
        <p className='text-sm text-muted-foreground'>
          {intl.formatMessage({ id: 'milestone.outcome.empty' })}
        </p>
      ) : (
        <div className='space-y-6'>
          {claims.length > 0 && (
            <div className='space-y-2'>
              <h3 className='text-sm font-medium text-foreground'>
                {intl.formatMessage({ id: 'milestone.outcome.claims.title' })}
              </h3>
              <ul className='space-y-1.5'>
                {claims.map(c => (
                  <li
                    key={c.taskId}
                    className='flex items-baseline gap-2 text-sm'
                  >
                    <span className='shrink-0 text-xs tabular-nums text-muted-foreground'>
                      {c.ref}
                    </span>
                    {c.claim ? (
                      <span className='min-w-0 text-foreground'>
                        {c.claim}
                        {c.source && KNOWN_SOURCES.has(c.source) && (
                          <span className='ml-1.5 text-xs text-muted-foreground'>
                            {intl.formatMessage({
                              id: `milestone.outcome.claims.source.${c.source}`,
                            })}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span
                        className='min-w-0 italic text-muted-foreground'
                        title={c.title}
                      >
                        {intl.formatMessage({
                          id: 'milestone.outcome.claims.noClaim',
                        })}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className='space-y-2'>
            <h3 className='text-sm font-medium text-foreground'>
              {intl.formatMessage({ id: 'milestone.outcome.fate.title' })}
            </h3>
            <p className='text-sm text-muted-foreground'>
              {intl.formatMessage(
                { id: 'milestone.outcome.fate.summary' },
                {
                  rejected: fate.rejected.length,
                  done: fate.doneCount,
                  inconclusive: fate.inconclusiveCount,
                }
              )}
            </p>
            {fate.rejected.length > 0 && (
              <ul className='space-y-1.5'>
                {fate.rejected.map(r => (
                  <li
                    key={r.taskId}
                    className='flex items-baseline gap-2 text-sm'
                  >
                    <span className='shrink-0 text-xs tabular-nums text-muted-foreground'>
                      {r.ref}
                    </span>
                    <span className='min-w-0 truncate text-foreground'>
                      {r.title}
                    </span>
                    <span className='shrink-0 text-xs text-muted-foreground'>
                      {r.kinds
                        .map(k =>
                          intl.formatMessage(
                            {
                              id: KNOWN_KINDS.has(k.kind)
                                ? `milestone.outcome.fate.kind.${k.kind}`
                                : 'milestone.outcome.fate.kind.UNKNOWN',
                            },
                            { kind: k.kind, count: k.count }
                          )
                        )
                        .join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
