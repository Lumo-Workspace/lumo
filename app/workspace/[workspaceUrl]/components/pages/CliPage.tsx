'use client'

import { useIntl } from 'react-intl'
import { CliStep } from '../cli/CliStep'
import { CodeBlock } from '../cli/CodeBlock'
import { CliCreateKeyForm } from '../cli/CliCreateKeyForm'

export function CliPage() {
  const intl = useIntl()

  return (
    <div className='h-full overflow-y-auto'>
      <div className='max-w-2xl mx-auto px-6 py-8'>
        <h1 className='text-xl font-semibold text-foreground mb-1'>
          {intl.formatMessage({ id: 'settings.cli' })}
        </h1>
        <p className='text-sm text-muted-foreground mb-8'>
          {intl.formatMessage({ id: 'cli.subtitle' })}
        </p>

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
    </div>
  )
}
