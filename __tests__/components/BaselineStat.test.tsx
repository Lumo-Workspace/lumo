/** @jest-environment jsdom */

// react-intl ships pure ESM and can't be transformed by jest without special
// config, so mock it the same way other component tests in this project do —
// but read the real en.json so copy assertions (e.g. "No baseline yet")
// resolve to real text.
jest.mock('react-intl', () => {
  const en = require('@/lib/i18n/en.json') as Record<string, string>
  return {
    useIntl: () => ({
      locale: 'en',
      formatMessage: (
        { id, defaultMessage }: { id: string; defaultMessage?: string },
        values?: Record<string, unknown>
      ) => {
        const template = en[id] ?? defaultMessage ?? id
        if (!values) return template
        return template.replace(/\{(\w+)(?:,[^}]*)?\}/g, (_, key) =>
          values[key] != null ? String(values[key]) : _
        )
      },
    }),
  }
})

import { render, screen } from '@testing-library/react'
import { BaselineStatView } from '@/components/BaselineStat'
import type { BaselineStat } from '@/lib/baseline/types'

const fmt = (n: number) => String(n)
function renderStat(stat: BaselineStat, baseLabel = 'baseline.median') {
  return render(
    <BaselineStatView stat={stat} formatValue={fmt} baseLabel={baseLabel} />
  )
}

const base = (o: Partial<BaselineStat>): BaselineStat => ({
  current: 12,
  base: 8,
  spread: { p25: 6, p75: 10 },
  sampleSize: 5,
  band: 'above',
  deltaPct: 50,
  deltaKind: 'magnitude',
  ...o,
})

describe('BaselineStatView', () => {
  it('has-base: shows current, base label+value, variance pill', () => {
    renderStat(base({}))
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText(/median/)).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.getByText(/\+50%/)).toBeInTheDocument()
  })

  it('no-base: shows 暂无基线, no pill', () => {
    renderStat(base({ base: null, spread: null, band: null, deltaPct: null }))
    expect(screen.getByText('No baseline yet')).toBeInTheDocument()
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
  })

  it('insufficient sample: shows 样本不足, hides base value', () => {
    renderStat(base({ sampleSize: 1 }))
    expect(screen.getByText('Baseline sample too small')).toBeInTheDocument()
  })

  it('current null: renders em-dash for current', () => {
    renderStat(base({ current: null, band: null, deltaPct: null }))
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})
