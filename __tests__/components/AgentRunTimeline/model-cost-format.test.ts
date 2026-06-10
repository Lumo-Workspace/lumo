import type { IntlShape } from 'react-intl'
import {
  fmtCompact,
  modelLabel,
} from '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/model-cost-format'
import { IN_FLIGHT_MODEL } from '@/types/model-cost'

const intl = {
  formatNumber: (n: number, opts?: Intl.NumberFormatOptions) =>
    new Intl.NumberFormat('en', opts).format(n),
  formatMessage: (d: { defaultMessage?: string }) => d.defaultMessage ?? '',
} as unknown as IntlShape

describe('fmtCompact', () => {
  it('renders compact notation with 1 max fraction digit', () => {
    expect(fmtCompact(intl, 12_300_000)).toBe('12.3M')
  })
})

describe('modelLabel', () => {
  it('strips the claude- prefix', () => {
    expect(modelLabel(intl, 'claude-opus-4-8')).toBe('opus-4-8')
  })

  it('returns the translated in-progress label for the IN_FLIGHT_MODEL sentinel', () => {
    expect(modelLabel(intl, IN_FLIGHT_MODEL)).toBe('in progress')
    expect(modelLabel(intl, IN_FLIGHT_MODEL)).not.toBe(IN_FLIGHT_MODEL)
  })

  it('leaves non-claude names untouched', () => {
    expect(modelLabel(intl, 'gpt-x')).toBe('gpt-x')
  })
})
