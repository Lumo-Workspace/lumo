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
import { CiIcon } from '@/app/workspace/[workspaceUrl]/components/pr-helpers'

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
