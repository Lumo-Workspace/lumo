/** @jest-environment jsdom */
import { render } from '@testing-library/react'
import { Input } from '@/components/ui/input'

describe('Input control-size tokens', () => {
  it('draws md height and the sm inline-padding tier', () => {
    const { container } = render(<Input placeholder='Search' />)
    const cls = (container.querySelector('input') as HTMLElement).className
    expect(cls).toContain('h-control-md')
    expect(cls).toContain('px-control-inset-sm')
  })
})
