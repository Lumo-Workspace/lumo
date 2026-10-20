import { cn } from '@/lib/utils'

// LUM-1273: the control-size tokens from app/globals.css
// (--spacing-control-sm|md|lg, --spacing-control-inset-sm|md|lg) must be known
// to tailwind-merge as spacing values. Otherwise a className size override on a
// primitive (Button/Input/Badge variants use h-control-*, w-control-*,
// px-control-inset-*) keeps BOTH classes and the token wins in the cascade, so
// the override is silently dead.
describe('cn() with control-size tokens', () => {
  it('lets a standard height override a control height', () => {
    expect(cn('h-control-md', 'h-8')).toBe('h-8')
    expect(cn('h-control-sm', 'h-auto')).toBe('h-auto')
    expect(cn('h-control-md', 'h-[--cell-size]')).toBe('h-[--cell-size]')
  })

  it('lets a standard inline padding override a control inset', () => {
    expect(cn('px-control-inset-md', 'px-2')).toBe('px-2')
    expect(cn('px-control-inset-sm py-2', 'p-0')).toBe('p-0')
  })

  it('lets size-* replace both the control height and width', () => {
    expect(cn('h-control-md w-control-md', 'size-7')).toBe('size-7')
  })

  it('lets a width override a control width', () => {
    expect(cn('w-control-md', 'w-full')).toBe('w-full')
  })

  it('collapses two control tokens of the same group to the last one', () => {
    expect(cn('h-control-md', 'h-control-sm')).toBe('h-control-sm')
    expect(cn('px-control-inset-md', 'px-control-inset-lg')).toBe(
      'px-control-inset-lg'
    )
  })

  it('lets a control token override a standard utility', () => {
    expect(cn('h-9', 'h-control-sm')).toBe('h-control-sm')
  })

  it('keeps control tokens next to unrelated or side-specific utilities', () => {
    expect(cn('h-control-md px-control-inset-sm', 'pl-8 min-h-8')).toBe(
      'h-control-md px-control-inset-sm pl-8 min-h-8'
    )
    expect(cn('h-control-md', 'sm:h-8')).toBe('h-control-md sm:h-8')
  })
})
