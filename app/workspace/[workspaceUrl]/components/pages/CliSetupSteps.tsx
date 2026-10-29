'use client'

import { useIntl } from 'react-intl'
import { CliStep } from '../cli/CliStep'
import { CodeBlock } from '../cli/CodeBlock'
import { CliCreateKeyForm } from '../cli/CliCreateKeyForm'

export function CliSetupSteps() {
  const intl = useIntl()

  return (
    <div>
      <CliStep
        index={1}
        title={intl.formatMessage({ id: 'cli.step.install.title' })}
        description={intl.formatMessage({
          id: 'cli.step.install.description',
        })}
      >
        <CodeBlock lines={['npm install -g @lumoai/cli', 'lumo init']} />
      </CliStep>

      <CliStep
        index={2}
        title={intl.formatMessage({ id: 'cli.step.login.title' })}
        description={intl.formatMessage({
          id: 'cli.step.login.description',
        })}
      >
        <CodeBlock lines={['lumo auth login']} />
        <CliCreateKeyForm />
      </CliStep>

      <CliStep
        index={3}
        title={intl.formatMessage({ id: 'cli.step.update.title' })}
        description={intl.formatMessage({
          id: 'cli.step.update.description',
        })}
      >
        <CodeBlock lines={['lumo update']} />
      </CliStep>
    </div>
  )
}
