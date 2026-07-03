/** @jest-environment jsdom */

// react-intl ships pure ESM and can't be transformed by jest without special
// config, so mock it the same way other component tests in this project do —
// but read the real en.json so band-label copy assertions resolve to real text.
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
import { VariancePill } from '@/components/VariancePill'

function renderPill(props: React.ComponentProps<typeof VariancePill>) {
  return render(<VariancePill {...props} />)
}

describe('VariancePill', () => {
  it('null band or delta → renders nothing', () => {
    const { container } = renderPill({
      band: null,
      deltaPct: null,
      deltaKind: 'magnitude',
    })
    expect(container).toBeEmptyDOMElement()
  })

  it('magnitude delta shows % with sign', () => {
    renderPill({ band: 'above', deltaPct: 50, deltaKind: 'magnitude' })
    expect(screen.getByText(/\+50%/)).toBeInTheDocument()
  })

  it('rate delta shows pt (percentage points)', () => {
    renderPill({ band: 'below', deltaPct: -15, deltaKind: 'rate' })
    expect(screen.getByText(/-15pt/)).toBeInTheDocument()
  })
})
