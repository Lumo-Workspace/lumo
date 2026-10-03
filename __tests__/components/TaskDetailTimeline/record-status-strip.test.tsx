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
    crossingsOpen: 0,
    crossingsBlocking: 0,
    crossingsTotal: 0,
    securityBlocking: 0,
    canBeDone: true,
    taskDone: false,
    ...p,
  }
}

describe('RecordStatusStrip', () => {
  it('renders nothing when the task has no crossings at all', () => {
    const { container } = render(<RecordStatusStrip gaps={gaps()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the crossings chip as a danger-toned anchor to #record-crossings', () => {
    render(
      <RecordStatusStrip
        gaps={gaps({
          crossingsOpen: 3,
          crossingsBlocking: 3,
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
    expect(screen.getByText('Still needed for Done')).toBeInTheDocument()
  })

  it('renders the crossings chip in the singular for count = 1', () => {
    render(
      <RecordStatusStrip
        gaps={gaps({
          crossingsOpen: 1,
          crossingsBlocking: 1,
          crossingsTotal: 1,
          canBeDone: false,
        })}
      />
    )
    expect(screen.getByTestId('gap-crossings')).toHaveTextContent(
      '1 crossing to disposition'
    )
  })

  it('renders the right-aligned progress chip when there are any crossings', () => {
    render(
      <RecordStatusStrip
        gaps={gaps({
          crossingsOpen: 2,
          crossingsBlocking: 2,
          crossingsTotal: 5,
          canBeDone: false,
        })}
      />
    )
    const progress = screen.getByTestId('gap-progress')
    expect(progress).toHaveTextContent('Dispositioned 3/5')
    expect(progress.className).toContain('ml-auto')
  })

  it('shows the success "nothing left" message when canBeDone and no gap chips remain', () => {
    render(<RecordStatusStrip gaps={gaps({ crossingsTotal: 2 })} />)
    const none = screen.getByTestId('gap-none')
    expect(none).toHaveTextContent('Nothing left — the task can be marked Done')
    expect(none.className).toContain('text-success')
    expect(screen.queryByTestId('gap-crossings')).toBeNull()
  })

  it('does not show "nothing left" when canBeDone is false even with no gap chips (e.g. security-only block)', () => {
    render(
      <RecordStatusStrip
        gaps={gaps({
          crossingsTotal: 1,
          securityBlocking: 1,
          canBeDone: false,
        })}
      />
    )
    expect(screen.queryByTestId('gap-none')).toBeNull()
  })

  // Review F5: an open crossing that does not block Done (advisory, or any
  // open crossing while the workspace gate is off) still needs dispositioning
  // — but a red chip overstated a queue nothing is waiting on.
  it('renders the crossings chip in the in-review tone with advisory copy when nothing blocks', () => {
    render(
      <RecordStatusStrip
        gaps={gaps({
          crossingsOpen: 3,
          crossingsBlocking: 0,
          crossingsTotal: 3,
          canBeDone: true,
        })}
      />
    )
    const chip = screen.getByTestId('gap-crossings')
    expect(chip).toHaveTextContent('3 advisory crossings to disposition')
    expect(chip.className).toContain('text-status-in-review')
    expect(chip.className).not.toContain('text-danger')
    expect(chip).toHaveAttribute('href', '#record-crossings')
  })

  it('renders the advisory crossings chip in the singular for count = 1', () => {
    render(
      <RecordStatusStrip
        gaps={gaps({
          crossingsOpen: 1,
          crossingsBlocking: 0,
          crossingsTotal: 1,
        })}
      />
    )
    expect(screen.getByTestId('gap-crossings')).toHaveTextContent(
      '1 advisory crossing to disposition'
    )
  })

  // Review F3: on an accepted task "the task can be marked Done" instructs a
  // decision that was already taken — the same slot states the outcome.
  it('says the task is accepted (not "can be marked Done") once it is DONE', () => {
    render(
      <RecordStatusStrip gaps={gaps({ crossingsTotal: 1, taskDone: true })} />
    )
    const accepted = screen.getByTestId('gap-accepted')
    expect(accepted).toHaveTextContent('Accepted — this task is Done')
    expect(accepted.className).toContain('text-success')
    expect(screen.queryByTestId('gap-none')).toBeNull()
  })

  // Review F7: the settled-state chip closes the line (mockup order), after
  // the disposition progress.
  it('renders the settled-state chip last, after the progress chip', () => {
    render(<RecordStatusStrip gaps={gaps({ crossingsTotal: 5 })} />)
    const strip = screen.getByText('Still needed for Done').parentElement!
    expect(strip.lastElementChild).toBe(screen.getByTestId('gap-none'))
    const chips = Array.from(strip.children).map(el =>
      el.getAttribute('data-testid')
    )
    expect(chips).toEqual([null, 'gap-progress', 'gap-none'])
  })

  it('renders plain (non-link) badges when interactive is false', () => {
    render(
      <RecordStatusStrip
        gaps={gaps({
          crossingsOpen: 1,
          crossingsBlocking: 1,
          crossingsTotal: 1,
          canBeDone: false,
        })}
        interactive={false}
      />
    )
    expect(screen.getByTestId('gap-crossings').tagName).toBe('SPAN')
  })
})
