import { cn } from '@/lib/utils'

// LUM-260: tailwind-merge must treat the semantic typography tiers as
// font-size utilities, NOT text-colors, so a tier and a color class survive
// being merged together. Bare twMerge dropped the color; extendTailwindMerge
// fixes it. Guard against the registration being removed.
describe('cn() with typography tiers', () => {
  it('keeps both a tier and a color class', () => {
    expect(cn('text-caption text-muted-foreground')).toBe(
      'text-caption text-muted-foreground'
    )
    expect(cn('text-muted-foreground', 'text-caption')).toBe(
      'text-muted-foreground text-caption'
    )
  })

  it('keeps a tier when className adds an unrelated text utility', () => {
    expect(
      cn('text-body [&:not(:first-child)]:mt-6', 'text-red-500')
    ).toContain('text-body')
  })

  it('collapses two competing tiers to the last one', () => {
    expect(cn('text-caption', 'text-body')).toBe('text-body')
  })
})
