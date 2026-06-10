import type { IntlShape } from 'react-intl'
import { IN_FLIGHT_MODEL } from '@/types/model-cost'

export function fmtCompact(intl: IntlShape, n: number): string {
  return intl.formatNumber(n, { notation: 'compact', maximumFractionDigits: 1 })
}

export function modelLabel(intl: IntlShape, model: string): string {
  if (model === IN_FLIGHT_MODEL)
    return intl.formatMessage({
      id: 'tokenCost.inFlight',
      defaultMessage: 'in progress',
    })
  return model.replace(/^claude-/, '')
}
