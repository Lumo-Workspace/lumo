/** @jest-environment jsdom */
import { render } from '@testing-library/react'
import { Button } from '@/components/ui/button'

describe('Button control-size tokens', () => {
  it('default size draws height + inline padding from the md tier', () => {
    const { getByRole } = render(<Button>Save</Button>)
    const cls = getByRole('button').className
    expect(cls).toContain('h-control-md')
    expect(cls).toContain('px-control-inset-md')
  })

  it('sm size uses the sm tier', () => {
    const { getByRole } = render(<Button size='sm'>Save</Button>)
    const cls = getByRole('button').className
    expect(cls).toContain('h-control-sm')
    expect(cls).toContain('px-control-inset-sm')
  })

  it('lg size uses the lg tier', () => {
    const { getByRole } = render(<Button size='lg'>Save</Button>)
    const cls = getByRole('button').className
    expect(cls).toContain('h-control-lg')
    expect(cls).toContain('px-control-inset-lg')
  })

  it('icon size is an md-height square', () => {
    const { getByRole } = render(
      <Button size='icon' aria-label='close'>
        x
      </Button>
    )
    const cls = getByRole('button').className
    expect(cls).toContain('h-control-md')
    expect(cls).toContain('w-control-md')
  })

  // LUM-1272: inline text-link actions carry no control box at all.
  it('inline size drops the control height and padding', () => {
    const { getByRole } = render(
      <Button variant='link' size='inline'>
        Edit
      </Button>
    )
    const cls = getByRole('button').className
    expect(cls).toContain('h-auto')
    expect(cls).toContain('p-0')
    expect(cls).not.toContain('h-control')
    expect(cls).not.toContain('px-control-inset')
  })

  // LUM-1274: compact square icon button for dense header toolbars.
  it('icon-sm size is an sm-height square', () => {
    const { getByRole } = render(
      <Button variant='ghost' size='icon-sm' aria-label='copy'>
        x
      </Button>
    )
    const cls = getByRole('button').className
    expect(cls).toContain('h-control-sm')
    expect(cls).toContain('w-control-sm')
    expect(cls).not.toContain('h-control-md')
  })
})
