'use client'

import { useIntl } from 'react-intl'
import { Star } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  ALIGN_VERDICTS,
  MAX_STARRED,
  type AlignVerdict,
} from '@/lib/plan-run/gate-b'

export interface ClusterCardState {
  clusterId: string
  verdict: AlignVerdict
  rationale: string
  customizationTrap: boolean
  starred: boolean
}

interface Props {
  cluster: ClusterCardState
  /** Star is disabled (cap reached) unless THIS card is already starred. */
  starCapReached: boolean
  onVerdictChange: (verdict: AlignVerdict) => void
  onRationaleChange: (rationale: string) => void
  onToggleStar: () => void
}

const VERDICT_LABEL: Record<AlignVerdict, string> = {
  ALIGNED: 'planGate.verdict.aligned',
  UNRELATED: 'planGate.verdict.unrelated',
  CONFLICT: 'planGate.verdict.conflict',
}

/**
 * One cluster card on the gate-B board (LUM-670). Shows the three-way verdict
 * toggle, the customization-trap badge, an editable one-line rationale, and a
 * star control that is usable ONLY on an ALIGNED cluster (and only while the
 * ≤2 star cap has room). Purely presentational — all state lives in the board.
 */
export function ClusterAlignCard({
  cluster,
  starCapReached,
  onVerdictChange,
  onRationaleChange,
  onToggleStar,
}: Props) {
  const intl = useIntl()
  const canStar = cluster.verdict === 'ALIGNED'
  // Cap only blocks starring a not-yet-starred card; you can always un-star.
  const starDisabled = !canStar || (starCapReached && !cluster.starred)

  return (
    <Card className='flex flex-col gap-3 p-4'>
      <div className='flex items-start justify-between gap-2'>
        <div
          role='radiogroup'
          aria-label={intl.formatMessage({ id: 'planGate.verdictLabel' })}
          className='inline-flex rounded-md border border-input p-0.5'
        >
          {ALIGN_VERDICTS.map(v => (
            <Button
              key={v}
              type='button'
              role='radio'
              aria-checked={cluster.verdict === v}
              size='sm'
              variant={cluster.verdict === v ? 'default' : 'ghost'}
              onClick={() => onVerdictChange(v)}
            >
              {intl.formatMessage({ id: VERDICT_LABEL[v] })}
            </Button>
          ))}
        </div>

        <Button
          type='button'
          size='sm'
          variant={cluster.starred ? 'default' : 'outline'}
          disabled={starDisabled}
          aria-pressed={cluster.starred}
          onClick={onToggleStar}
          title={intl.formatMessage(
            { id: 'planGate.starHint' },
            { max: MAX_STARRED }
          )}
        >
          <Star
            className={cn('h-4 w-4', cluster.starred && 'fill-current')}
            aria-hidden
          />
          {intl.formatMessage({ id: 'planGate.star' })}
        </Button>
      </div>

      {cluster.customizationTrap && (
        <Badge variant='destructive' className='w-fit'>
          {intl.formatMessage({ id: 'planGate.trapBadge' })}
        </Badge>
      )}

      <label className='flex flex-col gap-1 text-sm'>
        <span className='text-muted-foreground'>
          {intl.formatMessage({ id: 'planGate.rationaleLabel' })}
        </span>
        <Input
          value={cluster.rationale}
          onChange={e => onRationaleChange(e.target.value)}
          placeholder={intl.formatMessage({
            id: 'planGate.rationalePlaceholder',
          })}
        />
      </label>
    </Card>
  )
}
