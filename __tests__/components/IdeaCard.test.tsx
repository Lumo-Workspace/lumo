/**
 * @jest-environment jsdom
 *
 * LUM-685: the idea card gives its statement the card's full width, clamps a
 * long statement behind a show-more toggle, and moves the bucket control out of
 * the text's flow into a menu whose trigger label is fixed — so an arbitrarily
 * long cluster name can never crush the statement or overflow the column
 * (the regression: a native <select> sizes itself to its widest <option>).
 */

// Radix's dropdown needs portals + pointer capture jsdom doesn't implement;
// stub the primitives to passthrough so the card's own wiring is assertable.
// (Same approach as MilestoneActionsMenu.test.tsx.)
jest.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: React.ReactNode
    onSelect?: () => void
  }) => <button onClick={onSelect}>{children}</button>,
}))

jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (
      { id }: { id: string },
      values?: Record<string, unknown>
    ) => {
      const messages = jest.requireActual('@/lib/i18n/en.json') as Record<
        string,
        string
      >
      const raw = messages[id] ?? id
      return raw.replace(/\{(\w+)\}/g, (_m, k: string) =>
        String(values?.[k] ?? `{${k}}`)
      )
    },
  }),
}))

import { render, screen, fireEvent } from '@testing-library/react'
import {
  IdeaCard,
  isOverflowing,
} from '@/app/workspace/[workspaceUrl]/components/plan-run/IdeaCard'

beforeAll(() => {
  // jsdom has no layout engine and no ResizeObserver; the card observes its
  // statement to decide whether the clamp is actually truncating.
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

const TARGETS = [
  { value: '0', label: 'AI Native Sprints 的速度与吞吐度量能力' },
  { value: 'orphans', label: 'Orphans' },
]

function setup(overrides: Partial<Parameters<typeof IdeaCard>[0]> = {}) {
  const props = {
    statement: 'Idea A',
    sourceContext: null,
    moveTargets: TARGETS,
    moveLabel: 'Move idea Idea A',
    onMove: jest.fn(),
    movable: true,
    ...overrides,
  }
  render(<IdeaCard {...props} />)
  return props
}

describe('isOverflowing', () => {
  it('is true only when content exceeds the clamped box', () => {
    expect(isOverflowing({ scrollHeight: 120, clientHeight: 60 })).toBe(true)
    expect(isOverflowing({ scrollHeight: 60, clientHeight: 60 })).toBe(false)
  })

  it('tolerates sub-pixel rounding rather than showing a useless toggle', () => {
    expect(isOverflowing({ scrollHeight: 60.5, clientHeight: 60 })).toBe(false)
  })
})

describe('IdeaCard', () => {
  it('renders the statement clamped, out of the move control’s flow', () => {
    setup({ statement: 'A very long idea statement' })

    const statement = screen.getByText('A very long idea statement')
    // The clamp is what bounds the card height.
    expect(statement).toHaveClass('line-clamp-3')
    // The statement is a direct child of the card — NOT nested in a flex row
    // shared with the move control, which is what crushed it to a 2-3 char
    // strip. Its box therefore spans the card's full width.
    expect(statement.parentElement?.tagName).toBe('LI')
    // ...and the control is not a sibling inside that same text row.
    expect(statement.parentElement).not.toHaveClass('flex')
  })

  it('keeps the move trigger label fixed regardless of target names', () => {
    setup()

    // The trigger says "Move to…" — its width is independent of the (long)
    // cluster names, which live in the portalled menu instead.
    const trigger = screen.getByLabelText('Move idea Idea A')
    expect(trigger).toHaveTextContent('Move to…')
    expect(trigger).not.toHaveTextContent('AI Native Sprints')
  })

  it('moves the idea to the chosen bucket', () => {
    const { onMove } = setup()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'AI Native Sprints 的速度与吞吐度量能力',
      })
    )

    expect(onMove).toHaveBeenCalledWith('0')
  })

  it('renders no move control once the gate is closed', () => {
    setup({ movable: false })

    expect(screen.queryByLabelText('Move idea Idea A')).not.toBeInTheDocument()
    expect(screen.getByText('Idea A')).toBeInTheDocument()
  })

  it('shows the origin line when the idea carries one', () => {
    setup({ sourceContext: 'raised in standup' })

    expect(screen.getByText('raised in standup')).toBeInTheDocument()
  })

  it('hides the expand toggle when the statement is not truncated', () => {
    // jsdom reports scrollHeight === clientHeight === 0, i.e. "fits".
    setup({ statement: 'Short' })

    expect(
      screen.queryByRole('button', { name: 'Show more' })
    ).not.toBeInTheDocument()
  })

  it('expands and re-collapses a truncated statement', () => {
    // Force the probe to report truncation the way a real layout would.
    const proto = window.HTMLElement.prototype
    const scroll = Object.getOwnPropertyDescriptor(proto, 'scrollHeight')
    const client = Object.getOwnPropertyDescriptor(proto, 'clientHeight')
    Object.defineProperty(proto, 'scrollHeight', {
      configurable: true,
      value: 200,
    })
    Object.defineProperty(proto, 'clientHeight', {
      configurable: true,
      value: 60,
    })

    try {
      setup({ statement: 'A statement long enough to be clamped' })
      const statement = screen.getByText(
        'A statement long enough to be clamped'
      )

      const showMore = screen.getByRole('button', { name: 'Show more' })
      expect(showMore).toHaveAttribute('aria-expanded', 'false')

      fireEvent.click(showMore)

      // Expanded: clamp lifted, and the toggle must survive so it can collapse
      // again (re-measuring while expanded would report "fits" and hide it).
      expect(statement).not.toHaveClass('line-clamp-3')
      const showLess = screen.getByRole('button', { name: 'Show less' })
      expect(showLess).toHaveAttribute('aria-expanded', 'true')

      fireEvent.click(showLess)
      expect(statement).toHaveClass('line-clamp-3')
    } finally {
      if (scroll) Object.defineProperty(proto, 'scrollHeight', scroll)
      if (client) Object.defineProperty(proto, 'clientHeight', client)
    }
  })
})
