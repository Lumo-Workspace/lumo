/** @jest-environment jsdom */
/**
 * LUM-496 Task 1 — the Done-gap status strip. Mirrors the BoundaryCrossingsPanel
 * test's react-intl mock (real ICU plural + `{token}` substitution against
 * `defaultMessage`) so the plural chip copy (`record.gap.crossings` etc.)
 * renders exactly as it will in the app, without needing a real IntlProvider
 * (react-intl's ESM build isn't loadable through jest here — see
 * __tests__/components/TaskDetailTimeline/BoundaryCrossingsPanel.test.tsx).
 */
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      { id, defaultMessage }: { id: string; defaultMessage?: string },
      values?: Record<string, unknown>
    ) => {
      let msg = defaultMessage ?? id
      msg = msg.replace(
        /\{(\w+),\s*plural,\s*one\s*\{([^}]*)\}\s*other\s*\{([^}]*)\}\}/g,
        (_m, key, one, other) => {
          const n = Number(values?.[key] ?? 0)
          return (n === 1 ? one : other).replace('#', String(n))
        }
      )
      for (const [k, v] of Object.entries(values ?? {})) {
        msg = msg.split(`{${k}}`).join(String(v))
      }
      return msg
    },
  }),
}))

import { render, screen } from '@testing-library/react'
import { RecordStatusStrip } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/RecordStatusStrip'
import type { RecordGaps } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/record-gaps'

function gaps(p: Partial<RecordGaps> = {}): RecordGaps {
  return {
    machineAwaiting: 0,
    machineTotal: 0,
    machineVerified: 0,
    humanPending: 0,
    humanTotal: 0,
    crossingsOpen: 0,
    crossingsBlocking: 0,
    crossingsTotal: 0,
    securityBlocking: 0,
    canBeDone: true,
    ...p,
  }
}

describe('RecordStatusStrip', () => {
  it('renders nothing when there are no criteria and no crossings at all', () => {
    const { container } = render(<RecordStatusStrip gaps={gaps()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the crossings chip as a danger-toned anchor to #record-crossings', () => {
    render(
      <RecordStatusStrip
        gaps={gaps({
          machineTotal: 1,
          machineVerified: 1,
          crossingsOpen: 3,
          crossingsTotal: 5,
          canBeDone: false,
        })}
      />
    )
    const chip = screen.getByTestId('gap-crossings')
    expect(chip.tagName).toBe('A')
    expect(chip).toHaveAttribute('href', '#record-crossings')
    expect(chip).toHaveTextContent('3 crossings to disposition')
    expect(chip.className).toContain('text-danger')
  })

  it('renders the crossings chip in the singular for count = 1', () => {
    render(
      <RecordStatusStrip
        gaps={gaps({ crossingsOpen: 1, crossingsTotal: 1, canBeDone: false })}
      />
    )
    expect(screen.getByTestId('gap-crossings')).toHaveTextContent(
      '1 crossing to disposition'
    )
  })

  it('renders the machine chip as a warning-toned anchor to #record-machine', () => {
    render(
      <RecordStatusStrip
        gaps={gaps({
          machineTotal: 4,
          machineVerified: 0,
          machineAwaiting: 4,
          canBeDone: false,
        })}
      />
    )
    const chip = screen.getByTestId('gap-machine')
    expect(chip.tagName).toBe('A')
    expect(chip).toHaveAttribute('href', '#record-machine')
    expect(chip).toHaveTextContent('4 machine checks awaiting verification')
    expect(chip.className).toContain('text-warning')
  })

  it('renders the human chip as an in-review anchor to #record-human when pending', () => {
    render(
      <RecordStatusStrip
        gaps={gaps({ humanTotal: 2, humanPending: 2, canBeDone: false })}
      />
    )
    const chip = screen.getByTestId('gap-human')
    expect(chip.tagName).toBe('A')
    expect(chip).toHaveAttribute('href', '#record-human')
    expect(chip).toHaveTextContent('2 calls need your judgment')
    expect(chip.className).toContain('text-status-in-review')
  })

  it('renders the human-done badge (not a link) when all human criteria are judged', () => {
    render(
      <RecordStatusStrip gaps={gaps({ humanTotal: 2, humanPending: 0 })} />
    )
    const chip = screen.getByTestId('gap-human')
    expect(chip.tagName).toBe('SPAN')
    expect(chip).toHaveTextContent('Human-judged 2/2')
    expect(chip.className).toContain('text-success')
  })

  it('omits the human chip entirely when there are no human criteria', () => {
    render(
      <RecordStatusStrip gaps={gaps({ machineTotal: 1, machineVerified: 1 })} />
    )
    expect(screen.queryByTestId('gap-human')).toBeNull()
  })

  it('renders the right-aligned progress chip when there are any crossings', () => {
    render(
      <RecordStatusStrip
        gaps={gaps({ crossingsOpen: 2, crossingsTotal: 5, canBeDone: false })}
      />
    )
    const progress = screen.getByTestId('gap-progress')
    expect(progress).toHaveTextContent('Dispositioned 3/5')
    expect(progress.className).toContain('ml-auto')
  })

  it('omits the progress chip when there are no crossings at all', () => {
    render(
      <RecordStatusStrip gaps={gaps({ machineTotal: 1, machineVerified: 1 })} />
    )
    expect(screen.queryByTestId('gap-progress')).toBeNull()
  })

  it('shows the success "nothing left" message when canBeDone and no gap chips remain', () => {
    render(
      <RecordStatusStrip gaps={gaps({ machineTotal: 2, machineVerified: 2 })} />
    )
    const none = screen.getByTestId('gap-none')
    expect(none).toHaveTextContent('Nothing left — the task can be marked Done')
    expect(none.className).toContain('text-success')
    expect(screen.queryByTestId('gap-crossings')).toBeNull()
    expect(screen.queryByTestId('gap-machine')).toBeNull()
  })

  it('does not show "nothing left" when canBeDone is false even with no gap chips (e.g. security-only block)', () => {
    render(
      <RecordStatusStrip
        gaps={gaps({
          machineTotal: 1,
          machineVerified: 1,
          securityBlocking: 1,
          canBeDone: false,
        })}
      />
    )
    expect(screen.queryByTestId('gap-none')).toBeNull()
  })

  it('renders every chip together when every gap is present, plus the title', () => {
    render(
      <RecordStatusStrip
        gaps={gaps({
          machineTotal: 4,
          machineVerified: 0,
          machineAwaiting: 4,
          humanTotal: 2,
          humanPending: 2,
          crossingsOpen: 27,
          crossingsBlocking: 27,
          crossingsTotal: 27,
          canBeDone: false,
        })}
      />
    )
    expect(screen.getByText('Still needed for Done')).toBeInTheDocument()
    expect(screen.getByTestId('gap-crossings')).toBeInTheDocument()
    expect(screen.getByTestId('gap-machine')).toBeInTheDocument()
    expect(screen.getByTestId('gap-human')).toBeInTheDocument()
    expect(screen.getByTestId('gap-progress')).toHaveTextContent(
      'Dispositioned 0/27'
    )
  })

  it('renders plain (non-link) badges when interactive is false', () => {
    render(
      <RecordStatusStrip
        gaps={gaps({
          crossingsOpen: 1,
          crossingsTotal: 1,
          machineTotal: 1,
          machineAwaiting: 1,
          canBeDone: false,
        })}
        interactive={false}
      />
    )
    expect(screen.getByTestId('gap-crossings').tagName).toBe('SPAN')
    expect(screen.getByTestId('gap-machine').tagName).toBe('SPAN')
  })
})
