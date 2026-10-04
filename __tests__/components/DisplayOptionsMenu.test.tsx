/**
 * Mock react-intl to avoid ESM transform issues under jest.
 * Returns the key when no translation is registered, matching react-intl's
 * missing-translation fallback.
 */
const en: Record<string, string> = {
  'display.menuTrigger': 'Display',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => en[id] ?? id,
  }),
}))

import { render, screen } from '@testing-library/react'
import { DisplayOptionsMenu } from '@/app/workspace/[workspaceUrl]/components/DisplayOptionsMenu'

function renderMenu() {
  render(
    <DisplayOptionsMenu
      completedFilter='all'
      onCompletedFilterChange={jest.fn()}
      ordering='manual'
      onOrderingChange={jest.fn()}
    />
  )
  return screen.getByRole('button', { name: 'Display' })
}

describe('DisplayOptionsMenu trigger', () => {
  it('renders icon only with no visible label text', () => {
    const trigger = renderMenu()
    // The label was moved to aria-label/title — nothing renders as text, so the
    // button collapses to its icon.
    expect(trigger.textContent).toBe('')
    expect(trigger.querySelector('svg')).not.toBeNull()
  })

  it('keeps Display as the accessible name and hover title', () => {
    const trigger = renderMenu()
    expect(trigger).toHaveAttribute('aria-label', 'Display')
    expect(trigger).toHaveAttribute('title', 'Display')
  })
})
