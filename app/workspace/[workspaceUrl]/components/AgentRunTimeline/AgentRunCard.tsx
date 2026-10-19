'use client'

import { useIntl } from 'react-intl'
import { ChevronRight, Bot, Sparkles } from 'lucide-react'
import { MemberAvatar } from '@/components/MemberAvatar'
import { Badge } from '@/components/ui/badge'
import {
  CollapsibleCard,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import type { AgentRunSession } from '../../types'
import { segmentIntoTurns } from './segment-turns'
import { deriveRunDigest } from './derive-run-digest'
import { fmtCompact, modelLabel } from './model-cost-format'
import { TurnCard } from './TurnCard'
import { TokenCostBreakdown } from '../TokenCostBreakdown'
import { AgentBadge } from '../AgentBadge'
import { RunAttributionBadge, RunAttributionPanel } from './RunAttribution'
import { formatDurationMs } from '@/lib/datetime/duration'
import { runOverstated } from '@/lib/agent-run/usage-dedupe-cutoff'
import { RunRawRecordDelete } from './RunRawRecordDelete'

interface AgentRunCardProps {
  run: AgentRunSession
  defaultExpanded?: boolean
}

export function AgentRunCard({
  run,
  defaultExpanded = false,
}: AgentRunCardProps) {
  const intl = useIntl()
  const preDedupe = runOverstated(run)
  const preDedupeNotice = intl.formatMessage({
    id: 'usage.preDedupe.notice',
    defaultMessage:
      'Token figures recorded before Oct 3, 2026 are overstated by about 2× (an older CLI counted each message several times). Newer figures are accurate.',
  })
  const digest = run.runSummary ? [] : deriveRunDigest(run.items)
  const durationLabel = formatDurationMs(intl, run.durationMs)
  const startLabel = new Date(run.startedAt).toLocaleString(intl.locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  return (
    <CollapsibleCard defaultOpen={defaultExpanded}>
      <CollapsibleTrigger className='w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-muted transition-colors rounded-lg'>
        <ChevronRight
          className='size-4 text-muted-foreground shrink-0 transition-transform group-data-[state=open]/collapsible:rotate-90'
          aria-hidden
        />
        <Badge
          variant='muted'
          size='sm'
          shape='square'
          className='shrink-0 gap-1.5 font-semibold text-foreground'
          data-testid='run-number'
        >
          <Bot className='size-3' />
          {intl.formatMessage(
            { id: 'agentRun.runNumber', defaultMessage: 'Run #{n}' },
            { n: run.runNumber }
          )}
        </Badge>
        {run.member && (
          <span
            className='flex items-center gap-1.5 shrink-0'
            data-testid='run-member'
          >
            <MemberAvatar
              decorative
              name={run.member.name}
              imageUrl={run.member.imageUrl}
              size='xs'
            />
            <span className='text-caption'>{run.member.name}</span>
          </span>
        )}
        <AgentBadge agent={run.agent} />
        {run.attribution && (
          <RunAttributionBadge attribution={run.attribution} />
        )}
        <span className='text-caption text-muted-foreground shrink-0'>
          {startLabel}
        </span>
        <span className='ml-auto flex flex-wrap items-center gap-x-3 text-caption text-muted-foreground'>
          <span>{durationLabel}</span>
          <span>·</span>
          <span>
            {intl.formatMessage(
              {
                id: 'agentRun.toolCalls',
                defaultMessage: '{n, plural, one {# tool} other {# tools}}',
              },
              { n: run.toolCallCount }
            )}
          </span>
          {run.memoryCount > 0 && (
            <>
              <span>·</span>
              <span
                className='font-semibold text-foreground'
                data-testid='run-memory-count'
              >
                {intl.formatMessage(
                  {
                    id: 'agentRun.memoryCount',
                    defaultMessage:
                      '+{n, plural, one {# memory} other {# memories}}',
                  },
                  { n: run.memoryCount }
                )}
              </span>
            </>
          )}
          {run.cost && (
            <>
              <span>·</span>
              <span className='tabular-nums'>
                {run.cost.byModel.length === 1
                  ? intl.formatMessage(
                      {
                        id: 'agentRun.cost.perRunTok',
                        defaultMessage: '{tok} tok',
                      },
                      { tok: fmtCompact(intl, run.cost.byModel[0]!.total) }
                    )
                  : run.cost.byModel
                      .map(
                        m =>
                          `${modelLabel(intl, m.model)} ${fmtCompact(intl, m.total)}`
                      )
                      .join(' · ')}
              </span>
              {preDedupe && (
                <span
                  data-testid='run-pre-dedupe'
                  title={preDedupeNotice}
                  className='text-warning-text'
                >
                  {intl.formatMessage({
                    id: 'usage.preDedupe.marker',
                    defaultMessage: '≈2× overstated',
                  })}
                </span>
              )}
              {typeof run.cost.loopCount === 'number' && (
                <>
                  <span>·</span>
                  <span>
                    {intl.formatMessage(
                      {
                        id: 'agentRun.cost.loops',
                        defaultMessage:
                          '{n, plural, one {# loop} other {# loops}}',
                      },
                      { n: run.cost.loopCount }
                    )}
                  </span>
                </>
              )}
            </>
          )}
        </span>
      </CollapsibleTrigger>

      {run.runSummary ? (
        <div
          className='border-t border-border/80 px-4 py-2.5'
          data-testid='run-summary'
        >
          <div
            className='flex items-center gap-1.5 text-caption font-semibold text-foreground'
            data-testid='run-summary-label'
          >
            <Sparkles className='size-3' />
            {intl.formatMessage({
              id: 'agentRun.summaryLabel',
              defaultMessage: '本次运行',
            })}
          </div>
          <p className='text-caption text-muted-foreground'>{run.runSummary}</p>
        </div>
      ) : digest.length > 0 ? (
        <div className='border-t border-border/80 px-4 py-2.5'>
          <ul
            className='list-disc space-y-0.5 pl-5 text-caption text-muted-foreground'
            data-testid='run-digest'
          >
            {digest.map((line, i) => (
              <li key={`digest-${i}`} className='truncate'>
                {line}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <CollapsibleContent>
        <div className='border-t border-border/80 px-4 py-2'>
          {run.attribution && (
            <RunAttributionPanel attribution={run.attribution} />
          )}
          {run.cost && (
            <div className='mb-2'>
              {preDedupe && (
                <p
                  data-testid='run-pre-dedupe-notice'
                  className='mb-1 text-caption text-warning-text'
                >
                  {preDedupeNotice}
                </p>
              )}
              <TokenCostBreakdown
                variant='compact'
                collapsibleDetails
                models={run.cost.byModel}
                loopCount={run.cost.loopCount}
              />
            </div>
          )}
          {run.items.length === 0 ? (
            <p className='py-3 text-caption text-muted-foreground italic'>
              {intl.formatMessage({
                id: 'agentRun.noEvents',
                defaultMessage: '本次运行没有捕获到事件',
              })}
            </p>
          ) : (
            <div>
              {segmentIntoTurns(run.items).map((turn, i) => (
                <TurnCard key={`turn-${i}`} turn={turn} turnNumber={i + 1} />
              ))}
            </div>
          )}
          {/* LUM-944: shown only to the session's member or a workspace OWNER. */}
          {run.sessionId && <RunRawRecordDelete sessionId={run.sessionId} />}
        </div>
      </CollapsibleContent>
    </CollapsibleCard>
  )
}
