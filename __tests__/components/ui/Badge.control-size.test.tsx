/** @jest-environment jsdom */
import { render } from '@testing-library/react'
import { Badge } from '@/components/ui/badge'

describe('Badge control-size tokens', () => {
  it('uses the sm inline-padding tier', () => {
    const { container } = render(<Badge>New</Badge>)
    const cls = (container.firstChild as HTMLElement).className
    expect(cls).toContain('px-control-inset-sm')
  })

  it('keeps its py-0.5 vertical inset', () => {
    const { container } = render(<Badge>New</Badge>)
    const cls = (container.firstChild as HTMLElement).className
    expect(cls).toContain('py-0.5')
  })
})
