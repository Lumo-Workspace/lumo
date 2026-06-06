import { render, screen } from '@testing-library/react'
import {
  TypographyH1 as H1,
  TypographyH2,
  TypographyH3,
  TypographyH4,
  TypographyP,
  TypographySmall,
  TypographyMuted,
} from '@/components/ui/typography'

describe('TypographyH1', () => {
  it('defaults to text-left and no text-balance (page-heading idiom)', () => {
    render(<H1>Hello</H1>)
    const h1 = screen.getByRole('heading', { level: 1, name: 'Hello' })
    expect(h1.className).toContain('text-left')
    expect(h1.className).not.toContain('text-center')
    expect(h1.className).not.toContain('text-balance')
  })

  it('honors align="center" (restores marketing-page default)', () => {
    render(<H1 align='center'>Hero</H1>)
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1.className).toContain('text-center')
    expect(h1.className).not.toContain('text-left')
  })

  it('honors align="right"', () => {
    render(<H1 align='right'>Right</H1>)
    expect(screen.getByRole('heading', { level: 1 }).className).toContain(
      'text-right'
    )
  })

  it('balance=true adds text-balance', () => {
    render(<H1 balance>Balanced</H1>)
    expect(screen.getByRole('heading', { level: 1 }).className).toContain(
      'text-balance'
    )
  })

  it('balance=false (default) omits text-balance', () => {
    render(<H1>Plain</H1>)
    expect(screen.getByRole('heading', { level: 1 }).className).not.toContain(
      'text-balance'
    )
  })

  it('passes through className', () => {
    render(<H1 className='custom-tweak'>Foo</H1>)
    expect(screen.getByRole('heading', { level: 1 }).className).toContain(
      'custom-tweak'
    )
  })

  it('passes through extra HTML attributes', () => {
    render(
      <H1 id='page-title' data-testid='h'>
        Title
      </H1>
    )
    const h1 = screen.getByTestId('h')
    expect(h1.id).toBe('page-title')
    expect(h1.tagName).toBe('H1')
  })
})

describe('Typography tier mapping (LUM-260)', () => {
  it('H1 uses text-display and keeps tracking-tight', () => {
    render(<H1>Display</H1>)
    const el = screen.getByRole('heading', { level: 1 })
    expect(el.className).toContain('text-display')
    expect(el.className).not.toContain('text-4xl')
  })

  it('H2 and H3 use text-heading', () => {
    render(<TypographyH2>Two</TypographyH2>)
    render(<TypographyH3>Three</TypographyH3>)
    expect(screen.getByRole('heading', { level: 2 }).className).toContain(
      'text-heading'
    )
    expect(screen.getByRole('heading', { level: 3 }).className).toContain(
      'text-heading'
    )
  })

  it('H4 uses text-title', () => {
    render(<TypographyH4>Four</TypographyH4>)
    expect(screen.getByRole('heading', { level: 4 }).className).toContain(
      'text-title'
    )
  })

  it('TypographyP uses text-body', () => {
    render(<TypographyP>Body</TypographyP>)
    expect(screen.getByText('Body').className).toContain('text-body')
  })

  it('TypographySmall and TypographyMuted use text-caption', () => {
    render(<TypographySmall>Small</TypographySmall>)
    render(<TypographyMuted>Muted</TypographyMuted>)
    expect(screen.getByText('Small').className).toContain('text-caption')
    expect(screen.getByText('Muted').className).toContain('text-caption')
    expect(screen.getByText('Muted').className).toContain('text-muted-foreground')
  })
})
