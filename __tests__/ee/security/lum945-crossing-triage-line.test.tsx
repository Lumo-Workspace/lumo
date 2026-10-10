/** @jest-environment jsdom */
/**
 * LUM-945 — the panel line that shows how the AI triage scored a crossing.
 */
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatNumber: (n: number, o: { minimumFractionDigits?: number }) =>
      n.toFixed(o?.minimumFractionDigits ?? 0),
    formatMessage: (
      { defaultMessage }: { defaultMessage?: string },
      values?: Record<string, unknown>
    ) => {
      let msg = defaultMessage ?? ''
      for (const [k, v] of Object.entries(values ?? {})) {
        msg = msg.split(`{${k}}`).join(String(v))
      }
      return msg
    },
  }),
}))

import { render, screen } from '@testing-library/react'
import { CrossingTriageLine } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/CrossingTriageLine'

function renderLine(disposition: string | null, probability = 0.734) {
  return render(
    <CrossingTriageLine
      crossingId='c1'
      probability={probability}
      disposition={disposition}
    />
  )
}

describe('LUM-945 triage line', () => {
  it('says an auto-cleared crossing was cleared by AI triage and can be ruled confirmed', () => {
    renderLine('AUTO_LEGIT')
    const text = screen.getByTestId('boundary-triage-c1').textContent ?? ''
    expect(text).toContain('Auto-cleared by AI triage')
    expect(text).toContain('0.73')
    expect(text).toContain('0.60')
    expect(text).toContain('Rule it confirmed')
  })

  it('says an open crossing scored below the threshold needs a human', () => {
    renderLine(null, 0.41)
    const text = screen.getByTestId('boundary-triage-c1').textContent ?? ''
    expect(text).toContain('below the 0.60 threshold')
    expect(text).toContain('0.41')
  })

  it('only shows the score once a human has ruled', () => {
    renderLine('CONFIRMED')
    expect(screen.getByTestId('boundary-triage-c1').textContent).toBe(
      'AI triage scored P(legit) 0.73.'
    )
  })
})
