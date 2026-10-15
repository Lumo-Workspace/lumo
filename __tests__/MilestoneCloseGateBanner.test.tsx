/** @jest-environment jsdom */
/** LUM-1135: the milestone close-gate banner and its "Close anyway" override. */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

jest.mock('react-intl', () => {
  const messages = jest.requireActual('@/lib/i18n/en.json') as Record<
    string,
    string
  >
  return {
    useIntl: () => ({
      locale: 'en',
      formatMessage: (
        { id }: { id: string },
        values?: Record<string, string | number>
      ) =>
        Object.entries(values ?? {}).reduce(
          (acc, [k, v]) => acc.split(`{${k}`).join(String(v)),
          messages[id] ?? id
        ),
    }),
  }
})

import type { MilestoneCloseGateView } from '@/lib/api-client/test-cases'
import { MilestoneCloseGateBanner } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneCloseGateBanner'

const held: MilestoneCloseGateView = {
  held: 2,
  cases: [
    {
      number: 1,
      title: 'Round trip',
      state: 'held',
      reason: 'NOT_RUN',
      unprovenPass: false,
    },
    {
      number: 2,
      title: 'Approve',
      state: 'held',
      reason: 'PROVEN_DEFECT',
      unprovenPass: false,
    },
  ],
}

it('lists held cases with their reasons', () => {
  render(
    <MilestoneCloseGateBanner
      gate={held}
      allTasksDone={false}
      completed={false}
      onOverride={jest.fn()}
    />
  )
  expect(screen.getByText(/TC1/)).toBeInTheDocument()
  expect(screen.getByText(/Not run yet/)).toBeInTheDocument()
  expect(screen.getByText(/Proven defect/)).toBeInTheDocument()
})

it('offers Close anyway only when every task is done', () => {
  const { rerender } = render(
    <MilestoneCloseGateBanner
      gate={held}
      allTasksDone={false}
      completed={false}
      onOverride={jest.fn()}
    />
  )
  expect(screen.queryByRole('button', { name: /Close anyway/ })).toBeNull()
  rerender(
    <MilestoneCloseGateBanner
      gate={held}
      allTasksDone
      completed={false}
      onOverride={jest.fn()}
    />
  )
  expect(
    screen.getByRole('button', { name: /Close anyway/ })
  ).toBeInTheDocument()
})

it('requires a note before overriding', async () => {
  const onOverride = jest.fn().mockResolvedValue(undefined)
  render(
    <MilestoneCloseGateBanner
      gate={held}
      allTasksDone
      completed={false}
      onOverride={onOverride}
    />
  )
  await userEvent.click(screen.getByRole('button', { name: /Close anyway/ }))
  const confirm = screen.getByRole('button', { name: /Close milestone/ })
  expect(confirm).toBeDisabled()
  await userEvent.type(
    screen.getByRole('textbox'),
    'E2E env down; verified by hand'
  )
  await userEvent.click(confirm)
  expect(onOverride).toHaveBeenCalledWith('E2E env down; verified by hand')
})

it('says the gate is open when nothing holds', () => {
  render(
    <MilestoneCloseGateBanner
      gate={{ held: 0, cases: [] }}
      allTasksDone
      completed={false}
      onOverride={jest.fn()}
    />
  )
  expect(screen.getByText(/Close gate open/)).toBeInTheDocument()
})

it('keeps the note open and shows an error when the override fails', async () => {
  const onOverride = jest.fn().mockRejectedValue(new Error('403'))
  render(
    <MilestoneCloseGateBanner
      gate={held}
      allTasksDone
      completed={false}
      onOverride={onOverride}
    />
  )
  await userEvent.click(screen.getByRole('button', { name: /Close anyway/ }))
  await userEvent.type(screen.getByRole('textbox'), 'verified by hand')
  await userEvent.click(screen.getByRole('button', { name: /Close milestone/ }))
  expect(await screen.findByRole('alert')).toBeInTheDocument()
  expect(onOverride).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('textbox')).toHaveValue('verified by hand')
  expect(screen.getByRole('button', { name: /Close milestone/ })).toBeEnabled()
})

it('clears the previous failure on Cancel and when Close anyway is reopened', async () => {
  const onOverride = jest.fn().mockRejectedValue(new Error('403'))
  render(
    <MilestoneCloseGateBanner
      gate={held}
      allTasksDone
      completed={false}
      onOverride={onOverride}
    />
  )
  await userEvent.click(screen.getByRole('button', { name: /Close anyway/ }))
  await userEvent.type(screen.getByRole('textbox'), 'verified by hand')
  await userEvent.click(screen.getByRole('button', { name: /Close milestone/ }))
  expect(await screen.findByRole('alert')).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: /Cancel/ }))
  expect(screen.queryByRole('alert')).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: /Close anyway/ }))
  expect(screen.getByRole('textbox')).toBeInTheDocument()
  expect(screen.queryByRole('alert')).toBeNull()
})

it('says nothing holds the gate without claiming every case passed', () => {
  render(
    <MilestoneCloseGateBanner
      gate={{ held: 0, cases: [] }}
      allTasksDone
      completed={false}
      onOverride={jest.fn()}
    />
  )
  expect(
    screen.getByText(
      'Close gate open — every test case has passed or its proven defect was accepted.'
    )
  ).toBeInTheDocument()
})
