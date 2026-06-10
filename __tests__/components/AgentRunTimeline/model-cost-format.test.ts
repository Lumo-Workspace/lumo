import type { IntlShape } from 'react-intl'
import {
  fmtCompact,
  modelLabel,
} from '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/model-cost-format'
import { IN_FLIGHT_MODEL } from '@/types/model-cost'

const intlFor = (locale: string) =>
  ({
    formatNumber: (n: number, opts?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat(locale, opts).format(n),
    formatMessage: (d: { defaultMessage?: string }) => d.defaultMessage ?? '',
  }) as unknown as IntlShape

const intl = intlFor('en')

describe('fmtCompact', () => {
  it('renders compact notation with 1 max fraction digit', () => {
    expect(fmtCompact(intl, 12_300_000)).toBe('12.3M')
  })

  // LUM-399: fmtCompact is the single source for token-count formatting.
  // Units are locale-derived (CLDR), not hardcoded — en uses K/M, zh-CN
  // uses the 万-based scale. Locks the localization semantics so the
  // consolidation stays zero-behavior-change.
  it('localizes units per locale: en uses K/M', () => {
    expect(fmtCompact(intlFor('en'), 13_100)).toBe('13.1K')
    expect(fmtCompact(intlFor('en'), 10_624_000)).toBe('10.6M')
  })

  it('localizes units per locale: zh-CN uses 万', () => {
    expect(fmtCompact(intlFor('zh-CN'), 13_100)).toBe('1.3万')
    expect(fmtCompact(intlFor('zh-CN'), 10_624_000)).toBe('1062.4万')
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
