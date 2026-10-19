jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (d: { id?: string; defaultMessage?: string }) =>
      d.id ?? d.defaultMessage ?? '',
  }),
}))

jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid='tooltip-content'>{children}</div>
  ),
}))

import { render } from '@testing-library/react'
import {
  CiIcon,
  PrStateBadge,
} from '@/app/workspace/[workspaceUrl]/components/pr-helpers'
import { PrBadge } from '@/app/workspace/[workspaceUrl]/components/PrBadge'

describe('CiIcon', () => {
  it.each([
    ['success', 'lucide-circle-check', 'task.ciSuccess'],
    ['failure', 'lucide-circle-x', 'task.ciFailure'],
    ['pending', 'lucide-loader-circle', 'task.ciPending'],
  ])(
    'renders an icon with tooltip for status=%s',
    (status, iconClass, labelId) => {
      const { container, getByTestId } = render(<CiIcon status={status} />)
      const svg = container.querySelector('svg')
      expect(svg).not.toBeNull()
      expect(svg?.getAttribute('class')).toContain(iconClass)
      expect(getByTestId('tooltip-content').textContent).toBe(labelId)
    }
  )

  it.each([null, 'unknown', ''])(
    'renders a width-reserving placeholder with tooltip for status=%s',
    status => {
      const { getByTestId } = render(<CiIcon status={status} />)
      const placeholder = getByTestId('ci-icon-placeholder')
      expect(placeholder.tagName).toBe('SPAN')
      expect(placeholder.className).toContain('w-[13px]')
      expect(placeholder.className).toContain('h-[13px]')
      expect(placeholder.className).toContain('shrink-0')
      expect(getByTestId('tooltip-content').textContent).toBe('task.ciUnknown')
    }
  )
})

// LUM-1245: GitHub's PR state colours expressed with semantic tokens.
describe('PR state colours', () => {
  it.each([
    ['open', 'Open', ['bg-success-subtle', 'text-success-text']],
    [
      'merged',
      'Merged',
      ['bg-status-in-review-subtle', 'text-status-in-review-text'],
    ],
    ['closed', 'Closed', ['bg-danger-subtle', 'text-danger-text']],
    ['draft', 'Draft', ['bg-muted', 'text-muted-foreground']],
  ])(
    'PrStateBadge state=%s uses the GitHub colour token',
    (state, label, cls) => {
      const { getByText } = render(<PrStateBadge state={state} />)
      const badge = getByText(label)
      for (const c of cls) expect(badge.className).toContain(c)
    }
  )

  it.each([
    ['open', 'text-success-text'],
    ['merged', 'text-status-in-review-text'],
  ] as const)('PrBadge state=%s matches PrStateBadge', (state, cls) => {
    const { container } = render(<PrBadge state={state} />)
    const el = container.querySelector(`[data-pr-state='${state}']`)
    expect(el?.className).toContain(cls)
  })
})
