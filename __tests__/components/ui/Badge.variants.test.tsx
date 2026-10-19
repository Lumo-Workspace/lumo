/** @jest-environment jsdom */
import { render } from '@testing-library/react'
import { Badge, badgeVariants } from '@/components/ui/badge'

describe('Badge variants (LUM-1266)', () => {
  it('renders an inline span so it can sit inside <p> and links', () => {
    const { container } = render(<Badge>New</Badge>)
    const el = container.firstChild as HTMLElement
    expect(el.tagName).toBe('SPAN')
    expect(el).toHaveAttribute('data-slot', 'badge')
  })

  it('keeps the shadcn default look: semibold primary pill', () => {
    const cls = badgeVariants()
    expect(cls).toContain('bg-primary')
    expect(cls).toContain('font-semibold')
    expect(cls).toContain('rounded-full')
  })

  it.each(['info', 'success', 'warning', 'danger'] as const)(
    'subtle %s tone uses the -subtle fill, -border edge and -text label',
    tone => {
      const cls = badgeVariants({ variant: tone })
      expect(cls).toContain(`bg-${tone}-subtle`)
      expect(cls).toContain(`border-${tone}-border`)
      expect(cls).toContain(`text-${tone}-text`)
      expect(cls).not.toContain('font-semibold')
    }
  )

  it.each([
    ['muted', ['bg-muted', 'text-muted-foreground', 'border-transparent']],
    ['outline', ['border-border', 'text-foreground']],
    ['outline-muted', ['border-border', 'text-muted-foreground']],
    ['plain', ['border-transparent']],
  ] as const)('%s variant classes', (variant, expected) => {
    const cls = badgeVariants({ variant })
    for (const c of expected) expect(cls).toContain(c)
  })

  it('plain carries no colour of its own, so a data colour via style wins', () => {
    const { container } = render(
      <Badge variant='plain' style={{ backgroundColor: 'rgb(1, 2, 3)' }}>
        tag
      </Badge>
    )
    const el = container.firstChild as HTMLElement
    expect(el.className).not.toMatch(/\bbg-/)
    expect(el).toHaveStyle({ backgroundColor: 'rgb(1, 2, 3)' })
  })

  it.each([
    ['default', 'px-control-inset-sm'],
    ['sm', 'px-2'],
    ['xs', 'px-1.5'],
  ] as const)('size=%s uses %s', (size, cls) => {
    expect(badgeVariants({ size })).toContain(cls)
    expect(badgeVariants({ size })).toContain('py-0.5')
  })

  it('shape=square gives a rounded-sm chip instead of a pill', () => {
    const cls = badgeVariants({ shape: 'square' })
    expect(cls).toContain('rounded-sm')
    expect(cls).not.toContain('rounded-full')
  })

  it('a caller className overrides a variant class it conflicts with', () => {
    const { container } = render(
      <Badge variant='plain' className='bg-status-in-review-subtle'>
        Merged
      </Badge>
    )
    expect((container.firstChild as HTMLElement).className).toContain(
      'bg-status-in-review-subtle'
    )
  })
})
