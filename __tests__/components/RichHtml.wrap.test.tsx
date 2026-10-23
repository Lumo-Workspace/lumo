/**
 * Rich-text bodies wrap unbreakable runs instead of widening the page (a
 * mirrored Vercel bot comment's base64 marker overflowed the activity tab).
 */
import { render } from '@testing-library/react'
import { RichHtml } from '@/components/RichHtml'

describe('RichHtml wrapping', () => {
  it('always applies overflow-wrap:anywhere and keeps the caller classes', () => {
    const { container } = render(
      <RichHtml className='prose prose-sm' html='<p>x</p>' />
    )
    const el = container.firstElementChild!
    expect(el.className).toContain('[overflow-wrap:anywhere]')
    expect(el.className).toContain('prose prose-sm')
  })

  it('applies it without a caller className', () => {
    const { container } = render(<RichHtml html='<p>x</p>' />)
    expect(container.firstElementChild!.className).toBe(
      '[overflow-wrap:anywhere] [&_table]:[overflow-wrap:break-word]'
    )
  })
})
