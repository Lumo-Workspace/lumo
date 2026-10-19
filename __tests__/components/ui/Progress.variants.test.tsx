/** @jest-environment jsdom */
import { render } from '@testing-library/react'
import {
  Progress,
  clampPercent,
  progressIndicatorVariants,
  progressVariants,
} from '@/components/ui/progress'

function parts(ui: React.ReactElement) {
  const { container } = render(ui)
  const root = container.querySelector('[data-slot="progress"]') as HTMLElement
  const indicator = container.querySelector(
    '[data-slot="progress-indicator"]'
  ) as HTMLElement
  return { root, indicator }
}

describe('Progress variants (LUM-1266)', () => {
  it('keeps the shadcn default: primary fill on a primary-tinted h-2 track', () => {
    const { root, indicator } = parts(<Progress value={40} />)
    expect(root.className).toContain('bg-primary/20')
    expect(root.className).toContain('h-2')
    expect(indicator.className).toContain('bg-primary')
    expect(indicator).toHaveStyle({ transform: 'translateX(-60%)' })
  })

  it.each([
    ['success', 'bg-success-text'],
    ['info', 'bg-info'],
    ['danger', 'bg-danger'],
    ['muted', 'bg-muted-foreground/50'],
    ['chart', 'bg-chart-1'],
    ['foreground', 'bg-foreground'],
  ] as const)(
    'tone=%s colours the indicator %s on the muted track',
    (tone, cls) => {
      const { root, indicator } = parts(<Progress value={10} tone={tone} />)
      expect(root.className).toContain('bg-muted')
      expect(root.className).not.toContain('bg-primary/20')
      expect(indicator.className).toContain(cls)
    }
  )

  it.each([
    ['default', 'h-2'],
    ['sm', 'h-1.5'],
    ['xs', 'h-1'],
  ] as const)('size=%s sets the track height %s', (size, cls) => {
    expect(progressVariants({ size })).toContain(cls)
  })

  it('rounds the indicator so a partial fill keeps a rounded leading edge', () => {
    expect(progressIndicatorVariants({ tone: 'success' })).toContain(
      'rounded-full'
    )
  })

  it('exposes a progressbar with the clamped value', () => {
    const { root, indicator } = parts(<Progress value={120} tone='danger' />)
    expect(root).toHaveAttribute('role', 'progressbar')
    expect(root).toHaveAttribute('aria-valuenow', '100')
    expect(indicator).toHaveStyle({ transform: 'translateX(-0%)' })
  })

  it('clampPercent bounds values to 0–100 and treats missing as 0', () => {
    expect(clampPercent(-5)).toBe(0)
    expect(clampPercent(55)).toBe(55)
    expect(clampPercent(150)).toBe(100)
    expect(clampPercent(null)).toBe(0)
    expect(clampPercent(undefined)).toBe(0)
    expect(clampPercent(Number.NaN)).toBe(0)
  })
})
