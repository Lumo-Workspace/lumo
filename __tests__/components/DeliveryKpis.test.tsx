/** @jest-environment jsdom */

const en: Record<string, string> = {
  'retrospective.delivery': 'Delivery',
  'retrospective.iterations': 'Runs',
  'retrospective.interactionRounds': 'Interaction rounds',
  'retrospective.totalDuration': 'Run time',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => en[id] ?? id,
  }),
}))

import { render, screen } from '@testing-library/react'
import { DeliveryKpis } from '@/app/workspace/[workspaceUrl]/components/DeliveryKpis'

it('DeliveryKpis renders three labeled KPI columns and em-dash for null values', () => {
  render(<DeliveryKpis runs={3} interactionRounds={8} duration={null} />)

  // all three labels present
  expect(screen.getByText('Delivery')).toBeInTheDocument()
  expect(screen.getByText('Runs')).toBeInTheDocument()
  expect(screen.getByText('Interaction rounds')).toBeInTheDocument()
  expect(screen.getByText('Run time')).toBeInTheDocument()

  // values shown verbatim
  expect(screen.getByText('3')).toBeInTheDocument()
  expect(screen.getByText('8')).toBeInTheDocument()

  // null duration → em-dash
  expect(screen.getByText('—')).toBeInTheDocument()
})

it('DeliveryKpis duration-formats the duration in seconds', () => {
  render(<DeliveryKpis runs={1} interactionRounds={0} duration={217} />)
  expect(screen.getByText('3m 37s')).toBeInTheDocument()
})

it('DeliveryKpis renders em-dash for every null metric', () => {
  render(<DeliveryKpis runs={null} interactionRounds={null} duration={null} />)
  expect(screen.getAllByText('—')).toHaveLength(3)
})
