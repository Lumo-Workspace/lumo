import { render, screen } from '@testing-library/react'
import { TypographyH1 } from '@/components/ui/typography'

describe('TypographyH1', () => {
  it('defaults to text-left and no text-balance (page-heading idiom)', () => {
    render(<TypographyH1>Hello</TypographyH1>)
    const h1 = screen.getByRole('heading', { level: 1, name: 'Hello' })
    expect(h1.className).toContain('text-left')
    expect(h1.className).not.toContain('text-center')
    expect(h1.className).not.toContain('text-balance')
  })

  it('honors align="center" (restores marketing-page default)', () => {
    render(<TypographyH1 align='center'>Hero</TypographyH1>)
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1.className).toContain('text-center')
    expect(h1.className).not.toContain('text-left')
  })

  it('honors align="right"', () => {
    render(<TypographyH1 align='right'>Right</TypographyH1>)
    expect(screen.getByRole('heading', { level: 1 }).className).toContain(
      'text-right'
    )
  })

  it('balance=true adds text-balance', () => {
    render(<TypographyH1 balance>Balanced</TypographyH1>)
    expect(screen.getByRole('heading', { level: 1 }).className).toContain(
      'text-balance'
    )
  })

  it('balance=false (default) omits text-balance', () => {
    render(<TypographyH1>Plain</TypographyH1>)
    expect(screen.getByRole('heading', { level: 1 }).className).not.toContain(
      'text-balance'
    )
  })

  it('passes through className', () => {
    render(<TypographyH1 className='custom-tweak'>Foo</TypographyH1>)
    expect(screen.getByRole('heading', { level: 1 }).className).toContain(
      'custom-tweak'
    )
  })

  it('passes through extra HTML attributes', () => {
    render(
      <TypographyH1 id='page-title' data-testid='h'>
        Title
      </TypographyH1>
    )
    const h1 = screen.getByTestId('h')
    expect(h1.id).toBe('page-title')
    expect(h1.tagName).toBe('H1')
  })
})
