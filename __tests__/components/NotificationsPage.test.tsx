import { render, screen, within, fireEvent } from '@testing-library/react'
import { NotificationsPage } from '@/app/workspace/[workspaceUrl]/components/pages/NotificationsPage'
import { usePreferences } from '@/app/workspace/[workspaceUrl]/hooks/usePreferences'

jest.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/usePreferences', () => ({
  usePreferences: jest.fn(),
}))

const mockUsePreferences = usePreferences as jest.Mock

const ALL_ON = {
  notifyInAppAssigned: true,
  notifyInAppComment: true,
  notifyInAppAgentDone: true,
  notifyInAppAgentInput: true,
  notifyInAppMention: true,
  notifySlackAssigned: true,
  notifySlackComment: true,
  notifySlackAgentDone: true,
  notifySlackAgentInput: true,
  notifySlackMention: true,
}

function renderPage(updatePreferences = jest.fn()) {
  mockUsePreferences.mockReturnValue({
    prefs: ALL_ON,
    loading: false,
    updatePreferences,
  })
  render(<NotificationsPage />)
  return updatePreferences
}

function rowLabels(region: HTMLElement): string[] {
  return within(region)
    .getAllByRole('switch')
    .map(s => s.closest('div')?.querySelector('p')?.textContent ?? '')
}

describe('NotificationsPage (LUM-1098, LUM-1101)', () => {
  it('shows only the in-app toggles that have an in-app send path', () => {
    renderPage()
    const inApp = screen.getByRole('region', { name: 'notifications.inApp' })
    // Comment has no reader and AGENT_* notifications have no creator, so
    // those switches would do nothing; they stay hidden (columns kept).
    expect(rowLabels(inApp)).toEqual([
      'notifications.taskAssigned',
      'notifications.mentioned',
    ])
  })

  it('writes the matching in-app preference key when an in-app toggle flips', () => {
    const update = renderPage()
    const inApp = screen.getByRole('region', { name: 'notifications.inApp' })
    const switches = within(inApp).getAllByRole('switch')
    fireEvent.click(switches[1]!)
    expect(update).toHaveBeenCalledWith({ notifyInAppMention: false })
  })

  it('shows only the Slack toggles that have a Slack send path', () => {
    renderPage()
    const slack = screen.getByRole('region', { name: 'notifications.slack' })
    // Comment / agent-done / agent-input have no Slack sender, so their
    // switches would do nothing; they stay hidden until one exists.
    expect(rowLabels(slack)).toEqual([
      'notifications.taskAssigned',
      'notifications.mentioned',
    ])
  })

  it('writes the matching Slack preference key when a Slack toggle flips', () => {
    const update = renderPage()
    const slack = screen.getByRole('region', { name: 'notifications.slack' })
    const switches = within(slack).getAllByRole('switch')
    fireEvent.click(switches[1]!)
    expect(update).toHaveBeenCalledWith({ notifySlackMention: false })
  })
})
