/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react'

// Match the repo convention (see MilestoneSprintCoverage.test.tsx): jest can't
// transpile react-intl's ESM through the symlinked node_modules, so mock
// useIntl and resolve message ids through the real en.json.
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (
      descriptor: { id: string },
      values?: Record<string, unknown>
    ) => {
      const messages = jest.requireActual('@/lib/i18n/en.json') as Record<
        string,
        string
      >
      const template = messages[descriptor.id] ?? descriptor.id
      return values
        ? template.replace(/\{(\w+)\}/g, (_m, k) =>
            k in values ? String(values[k]) : `{${k}}`
          )
        : template
    },
  }),
}))

jest.mock('@/lib/api-client', () => ({
  sprintsClient: { setCadence: jest.fn().mockResolvedValue(undefined) },
}))

import { CadencePanel } from '@/app/workspace/[workspaceUrl]/sprints/components/CadencePanel'

const team = {
  id: 't1',
  name: 'Core',
  sprintsEnabled: true,
  sprintDurationDays: 14,
  sprintCooldownDays: 0,
  sprintStartWeekday: 1,
  sprintAutoCreate: 0,
  sprintAutoAddCompleted: false,
  timezone: 'Asia/Shanghai',
}

test('renders the timezone label and the current team timezone', () => {
  render(<CadencePanel team={team} />)
  expect(screen.getByText('Team timezone')).toBeInTheDocument()
  // The trigger shows the current value (Radix Select value is the trigger's text).
  expect(screen.getByLabelText('Team timezone')).toHaveTextContent(
    'Asia/Shanghai'
  )
})
