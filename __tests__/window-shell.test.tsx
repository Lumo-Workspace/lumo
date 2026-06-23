import { render, screen } from '@testing-library/react'

import { WindowShell } from '@/components/landing/home/window-shell'

// next/jest maps CSS modules to an identity proxy, so `styles.shellMock`
// resolves to the literal class name 'shellMock' — letting us assert the
// variant class and the traffic-light dots by class name.
describe('WindowShell', () => {
  it('renders three traffic light dots a label and body children', () => {
    const { container } = render(
      <WindowShell variant='mock' label={<span>my-label</span>}>
        <p>body content</p>
      </WindowShell>
    )

    expect(container.querySelectorAll('.dot')).toHaveLength(3)
    expect(screen.getByText('my-label')).toBeInTheDocument()
    expect(screen.getByText('body content')).toBeInTheDocument()
  })

  it('applies the matching variant class for mock and terminal', () => {
    const { container: mock } = render(
      <WindowShell variant='mock' label={null}>
        <span />
      </WindowShell>
    )
    expect(mock.querySelector('.shell')).toHaveClass('shellMock')

    const { container: term } = render(
      <WindowShell variant='terminal' label={null}>
        <span />
      </WindowShell>
    )
    expect(term.querySelector('.shell')).toHaveClass('shellTerminal')
  })

  it('forwards bodyClassName and bodyAriaLabel to the body region', () => {
    render(
      <WindowShell
        variant='terminal'
        label={null}
        bodyClassName='termBody'
        bodyAriaLabel='driving Lumo'
      >
        <span>x</span>
      </WindowShell>
    )

    expect(screen.getByLabelText('driving Lumo')).toHaveClass('termBody')
  })
})
