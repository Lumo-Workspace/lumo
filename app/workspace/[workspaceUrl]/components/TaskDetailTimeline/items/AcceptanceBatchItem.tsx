'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { Check, X, Circle, ChevronRight } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { WorkspaceMemberInfo } from '../../../types'
import type {
  CriterionBatchUnit,
  VerificationBatchUnit,
} from '../acceptance-aggregation'
import { CommentAvatar } from '../../CommentAvatar'
import { resolveActor, formatTimeAgo } from './CompactActivityItem'

interface AcceptanceBatchItemProps {
  unit: CriterionBatchUnit | VerificationBatchUnit
  members: WorkspaceMemberInfo[]
  agentActors: { actorId: string; name: string; avatarColor: string }[]
}

function readString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** ✓ / ✗ / ○ for a verdict, colored via the feedback tokens (never raw color). */
export function VerdictGlyph({ verdict }: { verdict: string }) {
  if (verdict === 'PASS' || verdict === 'PASS_WITH_FOLLOWUP') {
    return <Check className='size-3.5 text-success shrink-0' aria-hidden />
  }
  if (verdict === 'FAIL') {
    return <X className='size-3.5 text-danger shrink-0' aria-hidden />
  }
  return <Circle className='size-3 text-muted-foreground shrink-0' aria-hidden />
}

function CriterionBatchBody({ unit }: { unit: CriterionBatchUnit }) {
  const intl = useIntl()
  return (
    <div className='mt-1.5 space-y-1 border-l border-border pl-3'>
      {unit.items.map(item => {
        const p = item.payload ?? {}
        const op = readString(p.op)
        const after = p.after as
          | { statement?: unknown; verifierType?: unknown }
          | null
        const before = p.before as
          | { statement?: unknown; verifierType?: unknown }
          | null
        const statement = readString(after?.statement ?? before?.statement)
        const verifier = readString(after?.verifierType ?? before?.verifierType)
        const opLabel =
          op === 'DELETED'
            ? intl.formatMessage({
                id: 'acceptance.batch.op.deleted',
                defaultMessage: 'deleted',
              })
            : op === 'UPDATED'
              ? intl.formatMessage({
                  id: 'acceptance.batch.op.updated',
                  defaultMessage: 'updated',
                })
              : intl.formatMessage({
                  id: 'acceptance.batch.op.added',
                  defaultMessage: 'added',
                })
        return (
          <div
            key={item.id}
            className='flex items-baseline gap-1.5 text-[11px] text-muted-foreground'
          >
            <span className='font-medium text-foreground/70 shrink-0'>
              {opLabel}
            </span>
            {verifier ? (
              <span className='rounded-sm bg-muted px-1 text-[9px] font-semibold uppercase shrink-0'>
                {verifier}
              </span>
            ) : null}
            <span className='min-w-0'>{statement}</span>
          </div>
        )
      })}
    </div>
  )
}

function VerificationBatchBody({ unit }: { unit: VerificationBatchUnit }) {
  return (
    <div className='mt-1.5 space-y-1 border-l border-border pl-3'>
      {unit.items.map(item => {
        const p = item.payload ?? {}
        const verdict = readString(p.verdict)
        const statement = readString(p.statement)
        const evidence = readString(p.evidencePointer)
        return (
          <div
            key={item.id}
            className='flex items-baseline gap-1.5 text-[11px] text-muted-foreground'
          >
            <span className='translate-y-0.5'>
              <VerdictGlyph verdict={verdict} />
            </span>
            <div className='min-w-0'>
              <span>{statement}</span>
              {evidence ? (
                <span className='ml-1 text-foreground/50 break-all'>
                  · {evidence}
                </span>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function criterionSummary(
  unit: CriterionBatchUnit,
  intl: ReturnType<typeof useIntl>
): string {
  const head =
    unit.source === 'HUMAN_EDIT'
      ? intl.formatMessage({
          id: 'acceptance.batch.contractRevised',
          defaultMessage: 'revised the acceptance contract',
        })
      : intl.formatMessage({
          id: 'acceptance.batch.contractLocked',
          defaultMessage: 'locked the acceptance contract',
        })
  const counts = intl.formatMessage(
    {
      id: 'acceptance.batch.criterionCount',
      defaultMessage:
        '{total, plural, one {# criterion} other {# criteria}} ({machine} MACHINE / {human} HUMAN)',
    },
    { total: unit.total, machine: unit.machineCount, human: unit.humanCount }
  )
  return `${head} · ${counts}`
}

function verificationSummary(
  unit: VerificationBatchUnit,
  intl: ReturnType<typeof useIntl>
): string {
  const round = unit.round ?? '?'
  if (unit.verifierType === 'AGENT') {
    return intl.formatMessage(
      {
        id: 'acceptance.batch.agentSendBack',
        defaultMessage: 'agent sent the task back · round {round}',
      },
      { round }
    )
  }
  if (unit.verifierType === 'HUMAN') {
    return unit.failed > 0
      ? intl.formatMessage(
          {
            id: 'acceptance.batch.humanSendBack',
            defaultMessage: 'human sent the task back · round {round}',
          },
          { round }
        )
      : intl.formatMessage(
          {
            id: 'acceptance.batch.humanVerdict',
            defaultMessage:
              'human verdict · round {round} · {passed}/{total} passed',
          },
          { round, passed: unit.passed, total: unit.total }
        )
  }
  return intl.formatMessage(
    {
      id: 'acceptance.batch.machineRound',
      defaultMessage:
        'machine check · round {round} · {passed}/{total} passed',
    },
    { round, passed: unit.passed, total: unit.total }
  )
}

export function AcceptanceBatchItem({
  unit,
  members,
  agentActors,
}: AcceptanceBatchItemProps) {
  const intl = useIntl()
  const [expanded, setExpanded] = useState(false)
  const actor = resolveActor(
    { actorId: unit.actorId, actor: unit.actor },
    members,
    agentActors
  )

  const summary =
    unit.kind === 'criterion-batch'
      ? criterionSummary(unit, intl)
      : verificationSummary(unit, intl)

  // verdict tone chip: success when all passed, danger when any failed. Only
  // verification batches carry a verdict roll-up; criterion batches are neutral.
  const tone = unit.kind === 'verification-batch' ? unit.tone : null
  const toneChip =
    tone === 'success'
      ? 'bg-success-subtle border border-success-border text-foreground'
      : tone === 'danger'
        ? 'bg-danger-subtle border border-danger-border text-foreground'
        : null

  return (
    <div className='flex gap-2.5 py-2 text-caption text-muted-foreground'>
      <CommentAvatar
        isAgent={actor.isAgent}
        imageUrl={actor.imageUrl}
        initials={actor.initials}
      />
      <div className='flex-1 min-w-0'>
        <div className='flex items-baseline gap-2'>
          <span className='font-medium text-foreground'>{actor.name}</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className='text-[11px] text-muted-foreground'>
                {formatTimeAgo(unit.createdAt, intl.locale)}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {new Date(unit.createdAt).toLocaleString(intl.locale)}
            </TooltipContent>
          </Tooltip>
        </div>

        <div className='flex flex-wrap items-center gap-1.5'>
          <button
            type='button'
            aria-expanded={expanded}
            onClick={() => setExpanded(v => !v)}
            className='inline-flex items-center gap-1 text-left hover:text-foreground transition-colors'
          >
            <ChevronRight
              className={`size-3 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
              aria-hidden
            />
            <span>{summary}</span>
          </button>
          {toneChip ? (
            <span
              className={`rounded-sm px-1 text-[9px] font-bold ${toneChip}`}
            >
              {tone === 'success'
                ? intl.formatMessage({
                    id: 'acceptance.batch.tone.pass',
                    defaultMessage: 'PASS',
                  })
                : intl.formatMessage({
                    id: 'acceptance.batch.tone.fail',
                    defaultMessage: 'FAIL',
                  })}
            </span>
          ) : null}
          {unit.kind === 'verification-batch' && unit.commentId ? (
            <a
              href={`#comment-${unit.commentId}`}
              className='text-[11px] underline underline-offset-2 hover:text-foreground'
            >
              {intl.formatMessage({
                id: 'acceptance.batch.viewReason',
                defaultMessage: 'view reason comment',
              })}
            </a>
          ) : null}
        </div>

        {expanded ? (
          unit.kind === 'criterion-batch' ? (
            <CriterionBatchBody unit={unit} />
          ) : (
            <VerificationBatchBody unit={unit} />
          )
        ) : null}
      </div>
    </div>
  )
}
