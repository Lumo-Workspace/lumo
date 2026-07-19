/**
 * @jest-environment jsdom
 *
 * LUM-685: a gate-B card must say WHAT it is judging. Before this it was an
 * anonymous verdict+rationale pair — a reviewer had to reverse-engineer which
 * cluster it referred to from the rationale text — and the rationale itself sat
 * in a one-line input that cut long sentences off with no way to read the rest.
 */
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
      // Enough ICU for these keys: a `{n, plural, one {…} other {…}}` block,
      // which may sit anywhere in the message (LUM-688 embeds one mid-string),
      // followed by plain `{var}` substitution.
      const withPlurals = raw.replace(
        /\{(\w+), plural,\s*((?:\w+ \{[^}]*\}\s*)+)\}/g,
        (_m: string, key: string, arms: string) => {
          const n = Number(values?.[key] ?? 0)
          const byCategory = new Map<string, string>()
          for (const arm of arms.matchAll(/(\w+) \{([^}]*)\}/g)) {
            byCategory.set(arm[1]!, arm[2]!)
          }
          const chosen =
            (n === 1 ? byCategory.get('one') : undefined) ??
            byCategory.get('other') ??
            ''
          return chosen.replace('#', String(n))
        }
      )
      return withPlurals.replace(/\{(\w+)\}/g, (_m, k: string) =>
        String(values?.[k] ?? `{${k}}`)
      )
    },
  }),
}))

import { render, screen, fireEvent } from '@testing-library/react'
import {
  ClusterAlignCard,
  fitToContent,
  type ClusterCardState,
} from '@/app/workspace/[workspaceUrl]/components/plan-run/ClusterAlignCard'

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

describe('fitToContent', () => {
  it('adds the border back, since border-box height includes it but scrollHeight does not', () => {
    // 140 content+padding, 2px of border (offsetHeight − clientHeight).
    // Assigning 140px verbatim leaves the box a border short — still clipping.
    const el = {
      scrollHeight: 140,
      clientHeight: 60,
      offsetHeight: 62,
      style: { height: '' },
    }
    fitToContent(el)
    expect(el.style.height).toBe('142px')
  })

  it('grows the box to exactly its content when there is no border', () => {
    const el = {
      scrollHeight: 140,
      clientHeight: 60,
      offsetHeight: 60,
      style: { height: '' },
    }
    fitToContent(el)
    expect(el.style.height).toBe('140px')
  })

  it('leaves the box alone where there is no layout to measure', () => {
    // jsdom (and a detached node) report 0 — setting 0px would collapse it.
    const el = {
      scrollHeight: 0,
      clientHeight: 0,
      offsetHeight: 0,
      style: { height: '' },
    }
    fitToContent(el)
    expect(el.style.height).toBe('auto')
  })

  it('never subtracts height when clientHeight exceeds offsetHeight', () => {
    const el = {
      scrollHeight: 100,
      clientHeight: 80,
      offsetHeight: 70,
      style: { height: '' },
    }
    fitToContent(el)
    expect(el.style.height).toBe('100px')
  })

  it('tolerates a missing element', () => {
    expect(() => fitToContent(null)).not.toThrow()
  })
})

const CLUSTER: ClusterCardState = {
  clusterId: 'cluster-0',
  verdict: 'ALIGNED',
  rationale:
    '这个簇直接服务当前优先级：让团队看得见每个 sprint 的真实产出速度。',
  customizationTrap: false,
  starred: false,
  name: 'AI Native Sprints 的速度与吞吐度量能力',
  thrust: '让团队看得见每个 sprint 的真实产出速度',
  ideas: [
    { id: 'i1', statement: 'AI Native Sprints 需要统计 velocity' },
    { id: 'i2', statement: '速度统计要能按成员拆分' },
  ],
  // The board seeds every idea as kept; unchecking is the deliberate act
  // (LUM-688).
  keptIdeaIds: ['i1', 'i2'],
}

function setup(overrides: Partial<ClusterCardState> = {}, props = {}) {
  const handlers = {
    starCapReached: false,
    onVerdictChange: jest.fn(),
    onRationaleChange: jest.fn(),
    onToggleStar: jest.fn(),
    onToggleIdea: jest.fn(),
    ...props,
  }
  render(
    <ClusterAlignCard cluster={{ ...CLUSTER, ...overrides }} {...handlers} />
  )
  return handlers
}

describe('ClusterAlignCard — cluster identity', () => {
  it('names the cluster and shows its thrust', () => {
    setup()

    expect(
      screen.getByRole('heading', {
        name: 'AI Native Sprints 的速度与吞吐度量能力',
      })
    ).toBeInTheDocument()
    expect(
      screen.getByText('让团队看得见每个 sprint 的真实产出速度')
    ).toBeInTheDocument()
  })

  it('shows an idea count that expands to the statements', () => {
    setup()

    const toggle = screen.getByRole('button', { name: /2 ideas/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    // Collapsed by default — the count is the at-a-glance signal.
    expect(
      screen.queryByText('AI Native Sprints 需要统计 velocity')
    ).not.toBeInTheDocument()

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(
      screen.getByText('AI Native Sprints 需要统计 velocity')
    ).toBeInTheDocument()
    expect(screen.getByText('速度统计要能按成员拆分')).toBeInTheDocument()
  })

  it('pluralises the idea count', () => {
    // The count now reports kept/total (LUM-688) but keeps the plural form.
    setup({ ideas: [{ id: 'i1', statement: 'Only one' }], keptIdeaIds: ['i1'] })
    expect(
      screen.getByRole('button', { name: '1 of 1 idea kept' })
    ).toBeInTheDocument()
  })

  it('reports how many of the cluster\u2019s ideas are kept', () => {
    setup({ keptIdeaIds: ['i1'] })
    expect(
      screen.getByRole('button', { name: '1 of 2 ideas kept' })
    ).toBeInTheDocument()
  })

  it('falls back to a placeholder when the name is unresolvable', () => {
    // Service degrades name to '' when the clusterId can't be joined back.
    setup({ name: '', thrust: '' })
    expect(
      screen.getByRole('heading', { name: 'Unnamed cluster' })
    ).toBeInTheDocument()
  })

  it('omits the ideas control for a cluster with no ideas', () => {
    setup({ ideas: [] })
    expect(
      screen.queryByRole('button', { name: /idea/ })
    ).not.toBeInTheDocument()
  })
})

describe('ClusterAlignCard — rationale', () => {
  it('renders the full rationale in a multi-line control, not a one-line input', () => {
    setup()

    const rationale = screen.getByLabelText('Rationale')
    // A textarea holds its value as content and wraps; an <input> truncates.
    expect(rationale.tagName).toBe('TEXTAREA')
    expect(rationale).toHaveValue(CLUSTER.rationale)
  })

  it('reports edits', () => {
    const { onRationaleChange } = setup()

    fireEvent.change(screen.getByLabelText('Rationale'), {
      target: { value: 'new reason' },
    })

    expect(onRationaleChange).toHaveBeenCalledWith('new reason')
  })

  it('shows the customization-trap marker when set', () => {
    setup({ customizationTrap: true })
    expect(screen.getByText('Customization trap')).toBeInTheDocument()
  })

  it('hides the trap marker when not set', () => {
    setup({ customizationTrap: false })
    expect(screen.queryByText('Customization trap')).not.toBeInTheDocument()
  })
})

describe('ClusterAlignCard — star', () => {
  it('is disabled unless the verdict is ALIGNED', () => {
    setup({ verdict: 'CONFLICT' })
    expect(screen.getByRole('button', { name: /Star/ })).toBeDisabled()
  })

  it('is disabled at the cap for a not-yet-starred card', () => {
    setup({ starred: false }, { starCapReached: true })
    expect(screen.getByRole('button', { name: /Star/ })).toBeDisabled()
  })

  it('stays enabled at the cap for an already-starred card (un-starring)', () => {
    setup({ starred: true }, { starCapReached: true })
    expect(screen.getByRole('button', { name: /Star/ })).toBeEnabled()
  })

  it('carries the real star hint, not a raw message id', () => {
    // planGate.starHint takes {max}; omitting it threw a FORMAT_ERROR and
    // react-intl fell back to rendering the id to the user.
    setup()
    expect(screen.getByRole('button', { name: /Star/ })).toHaveAttribute(
      'title',
      'Star up to 2 aligned clusters to plan now'
    )
  })
})
