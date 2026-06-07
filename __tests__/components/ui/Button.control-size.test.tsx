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
})
