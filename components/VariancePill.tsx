'use client'

import { useIntl } from 'react-intl'
import type { BaselineBand, BaselineDeltaKind } from '@/lib/baseline/types'
import { Badge } from '@/components/ui/badge'

const BAND_KEY: Record<BaselineBand, string> = {
  within: 'retrospective.bandWithin',
  above: 'retrospective.bandAbove',
  below: 'retrospective.bandBelow',
}

/**
 * 偏差胶囊:淡色仅作轻提示,层级靠数字权重(沿用 LUM-524 token 区约定)。
 * deltaKind='rate' → 偏差是百分点(pt);'magnitude' → 百分比(%)。
 */
export function VariancePill({
  band,
  deltaPct,
  deltaKind,
}: {
  band: BaselineBand | null
  deltaPct: number | null
  deltaKind: BaselineDeltaKind
}) {
  const intl = useIntl()
  if (band === null || deltaPct === null) return null
  const variant = band === 'within' ? 'success' : 'warning'
  const sign = deltaPct > 0 ? '+' : ''
  const unit = deltaKind === 'rate' ? 'pt' : '%'
  return (
    <Badge variant={variant} size='sm'>
      {sign}
      {deltaPct}
      {unit} · {intl.formatMessage({ id: BAND_KEY[band] })}
    </Badge>
  )
}
