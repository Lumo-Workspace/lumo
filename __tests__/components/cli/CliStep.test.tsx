import { render, screen } from '@testing-library/react'
import { CliStep } from '@/app/workspace/[workspaceUrl]/components/cli/CliStep'

describe('CliStep', () => {
  it('renders the numeric index, title, and description', () => {
    render(
      <CliStep
        index={2}
        title='Log in'
        description='Run lumo auth login to authenticate.'
      />
    )
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('Log in')).toBeInTheDocument()
    expect(
      screen.getByText('Run lumo auth login to authenticate.')
    ).toBeInTheDocument()
  })

  it('renders children below the description', () => {
    render(
      <CliStep index={1} title='Install' description='Install the CLI.'>
        <div data-testid='child-content'>child</div>
      </CliStep>
    )
    expect(screen.getByTestId('child-content')).toBeInTheDocument()
  })
})
