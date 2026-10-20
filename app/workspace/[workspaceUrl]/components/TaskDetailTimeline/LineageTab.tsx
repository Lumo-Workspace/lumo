'use client'

import { useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import { GitBranch } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { useTaskLineage } from '../../hooks/useTaskLineage'
import { TokenCostBreakdown } from '../TokenCostBreakdown'
import type {
  LineageDisclosure,
  LineageFragment,
  LineageOutcome,
} from '../../types'
import { DisclosureFunnel } from './DisclosureFunnel'
import { TopOperations } from './TopOperations'

interface LineageTabProps {
  taskIdentifier: string
  enabled: boolean
  /**
   * Whether to render the session-level cost block (LUM-567). Inside the task
   * dossier the cost total is owned by the ③ "cost & risk" region (field-unique
   * home), so the ④ Lineage sub-section passes `showCost={false}` to avoid a
   * second copy of the same number. Defaults to true for the standalone use.
   */
  showCost?: boolean
}

// Fixed display order for outcome rollups, mirroring the CLI's OUTCOME_ORDER
// (cli/src/commands/task-lineage.ts) so the web + terminal audit views agree.
const OUTCOME_ORDER: LineageOutcome[] = [
  'MERGED',
  'REWORKED',
  'REJECTED',
  'UNKNOWN',
]

// Outcome badge styling via the semantic feedback tokens (LUM-258/290):
// -subtle tint + -border + accent dot, with the LABEL kept neutral
// (text-foreground/-muted) because the bright accents fail AA as text on their
// own subtle tint. UNKNOWN carries no color — typography only.
const OUTCOME_BADGE: Record<LineageOutcome, BadgeProps['variant']> = {
  MERGED: 'success',
  REWORKED: 'warning',
  REJECTED: 'danger',
  UNKNOWN: 'outline-muted',
}

function disclosureLabel(
  intl: ReturnType<typeof useIntl>,
  disclosure: LineageDisclosure,
  pulled: boolean
): string {
  if (disclosure === 'FULL')
    return intl.formatMessage({
      id: 'lineage.fragment.disclosure.full',
      defaultMessage: '全文',
    })
  return pulled
    ? intl.formatMessage({
        id: 'lineage.fragment.disclosure.indexPulled',
        defaultMessage: '仅索引·已展开',
      })
    : intl.formatMessage({
        id: 'lineage.fragment.disclosure.indexNotPulled',
        defaultMessage: '仅索引·未展开',
      })
}

function usedLabel(
  intl: ReturnType<typeof useIntl>,
  used: boolean | null
): string {
  if (used === true)
    return intl.formatMessage({
      id: 'lineage.fragment.used.yes',
      defaultMessage: '✓ 已采用',
    })
  if (used === false)
    return intl.formatMessage({
      id: 'lineage.fragment.used.no',
      defaultMessage: '✗ 未采用',
    })
  return intl.formatMessage({
    id: 'lineage.fragment.used.abstained',
    defaultMessage: '· 未表态',
  })
}

export function LineageTab({
  taskIdentifier,
  enabled,
  showCost = true,
}: LineageTabProps) {
  const intl = useIntl()
  const { data, loading, error } = useTaskLineage({
    identifier: taskIdentifier,
    enabled,
  })
  const [showAllFragments, setShowAllFragments] = useState(false)

  const fragments = useMemo<LineageFragment[]>(
    () => (data ? data.groups.flatMap(g => g.fragments) : []),
    [data]
  )

  if (loading && !data) {
    return (
      <div className='py-8 text-center text-caption text-muted-foreground'>
        {intl.formatMessage({
          id: 'lineage.loading',
          defaultMessage: '加载中…',
        })}
      </div>
    )
  }

  if (error) {
    return (
      <div className='py-8 text-center text-caption text-danger-text'>
        {error}
      </div>
    )
  }

  if (!data || data.groups.length === 0) {
    return (
      <div className='py-12 flex flex-col items-center gap-2 text-muted-foreground'>
        <GitBranch className='size-6' />
        <p className='text-caption'>
          {intl.formatMessage({
            id: 'lineage.empty',
            defaultMessage: '此任务暂无 lineage 记录',
          })}
        </p>
        <p className='text-caption text-muted-foreground max-w-xs text-center'>
          {intl.formatMessage({
            id: 'lineage.emptyHint',
            defaultMessage:
              '当绑定它的 agent 会话消费 context 时，因果记录会自动生成在这里',
          })}
        </p>
      </div>
    )
  }

  const { totals } = data
  const { tokens } = totals

  // "107 MERGED · 2 REWORKED" — fixed order, zeros omitted. Outcome enum values
  // are raw data (like fragmentType), mirrored from the API/CLI verbatim.
  const outcomeSummary = OUTCOME_ORDER.filter(o => totals.outcomes[o] > 0)
    .map(o => `${totals.outcomes[o]} ${o}`)
    .join(' · ')

  return (
    <Card className='text-caption'>
      {/* Summary row */}
      <div className='px-3 py-2 border-b border-border text-muted-foreground'>
        {intl.formatMessage(
          {
            id: 'lineage.summary',
            defaultMessage:
              '{fragments, plural, one {# fragment} other {# fragments}} · {outcomes} · {sessions, plural, one {# session} other {# sessions}}',
          },
          {
            fragments: totals.fragmentCount,
            outcomes: outcomeSummary,
            sessions: totals.runCount,
          }
        )}
      </div>

      <DisclosureFunnel funnel={totals.funnel} />
      <TopOperations
        operations={totals.topOperations}
        taskIdentifier={taskIdentifier}
      />

      {/* Cost block — reuses the shared breakdown. Lineage is session-level &
          flat, so pass a single unnamed model group + loopCount=null so the
          component renders identically to before (2xl total, "loops n/a").
          Empty state kept inline to preserve the lineage-specific i18n key.
          Suppressed inside the dossier (showCost=false): cost's unique home is
          the ③ region, so the ④ Lineage sub-section must not re-print it. */}
      {showCost ? (
        <div className='border-b border-border'>
          {tokens.total > 0 ? (
            <TokenCostBreakdown
              variant='full'
              loopCount={null}
              models={[
                {
                  model: '',
                  input: tokens.input,
                  output: tokens.output,
                  cacheRead: tokens.cacheRead,
                  cacheCreation: tokens.cacheCreation,
                  total: tokens.total,
                },
              ]}
              chips={[
                { id: 'lineage.chip.sessionLevel', defaultMessage: '会话级' },
                { id: 'lineage.chip.live', defaultMessage: '实时' },
                {
                  id: 'lineage.chip.notPerFragment',
                  defaultMessage: '非每片段',
                },
              ]}
            />
          ) : (
            <div className='px-3 py-3'>
              <div className='mb-1 text-caption text-muted-foreground'>
                {intl.formatMessage({
                  id: 'lineage.cost.label',
                  defaultMessage: 'Cost',
                })}
              </div>
              <div className='mt-1 text-muted-foreground'>
                {intl.formatMessage({
                  id: 'lineage.cost.none',
                  defaultMessage: '此条线索暂无采集到的成本',
                })}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* Fragments list */}
      <Collapsible open={showAllFragments} onOpenChange={setShowAllFragments}>
        <CollapsibleContent>
          {fragments.map((f, i) => (
            <div
              key={`${f.fragmentType}-${f.fragmentId}-${i}`}
              className='flex items-center gap-2 px-3 py-1.5 border-t border-border/60 first:border-t-0 text-muted-foreground'
            >
              <Badge
                variant={OUTCOME_BADGE[f.outcome]}
                size='xs'
                shape='square'
                className={
                  f.outcome === 'UNKNOWN'
                    ? 'font-semibold'
                    : 'font-semibold text-foreground'
                }
              >
                {f.outcome}
              </Badge>
              <span className='truncate'>
                {f.fragmentType} — {f.sourceLabel}
              </span>
              <span className='ml-auto shrink-0 text-caption text-muted-foreground/80'>
                {disclosureLabel(intl, f.disclosure, f.pulled)}
              </span>
              <span className='shrink-0 text-caption text-muted-foreground/80'>
                {usedLabel(intl, f.used)}
              </span>
            </div>
          ))}
        </CollapsibleContent>

        {fragments.length > 0 && (
          <CollapsibleTrigger asChild>
            <Button
              type='button'
              variant='ghost'
              size='inline'
              className='w-full justify-start rounded-none border-t border-border/60 px-3 py-2 text-caption font-normal text-muted-foreground'
            >
              {showAllFragments
                ? intl.formatMessage({
                    id: 'lineage.fragments.collapse',
                    defaultMessage: '收起',
                  })
                : intl.formatMessage(
                    {
                      id: 'lineage.fragments.showAll',
                      defaultMessage: 'Show all {count} fragments',
                    },
                    { count: fragments.length }
                  )}
            </Button>
          </CollapsibleTrigger>
        )}
      </Collapsible>
    </Card>
  )
}
