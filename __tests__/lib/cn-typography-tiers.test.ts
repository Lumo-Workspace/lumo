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

// LUM-1272: control size tokens merge like any other spacing value, so a
// className override on a sized primitive replaces the base size.
describe('cn() with control size tokens', () => {
  it('lets an override replace the control height and inset', () => {
    expect(cn('h-control-md px-control-inset-md py-2', 'h-auto p-0')).toBe(
      'h-auto p-0'
    )
    expect(cn('h-control-sm px-control-inset-sm', 'px-2')).toBe(
      'h-control-sm px-2'
    )
  })

  it('collapses competing control heights to the last one', () => {
    expect(cn('h-8', 'h-control-sm')).toBe('h-control-sm')
    expect(cn('h-control-md w-control-md', 'size-7')).toBe('size-7')
  })
})
