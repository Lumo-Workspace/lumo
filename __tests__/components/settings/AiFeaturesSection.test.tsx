/**
 * LUM-1338 — the AI feature switches on the settings page: the master switch
 * cannot open without a model, a parent switch disables (and shows off) its
 * children, and a click writes exactly one switch.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import {
  AI_FEATURE_KEYS,
  resolveAiFeatures,
  type AiFeatureSwitches,
} from '@/lib/ai-features/registry'

jest.mock('react-intl', () => {
  const messages = jest.requireActual('@/lib/i18n/en.json') as Record<
    string,
    string
  >
  return {
    useIntl: () => ({
      formatMessage: ({ id }: { id: string }) => {
        const text = messages[id]
        if (text === undefined) throw new Error(`missing message ${id}`)
        return text
      },
    }),
  }
})

const mutate = jest.fn()
let mockStatus: unknown = null

jest.mock('@/hooks/use-ai-features', () => ({
  useAiFeatures: () => ({
    status: mockStatus,
    isLoading: false,
    error: null,
    isOn: () => true,
  }),
  useSetAiFeature: () => ({ mutate, isPending: false }),
}))

import { AiFeaturesSection } from '@/app/workspace/[workspaceUrl]/components/settings/AiFeaturesSection'

function status(aiConfigured: boolean, switches: AiFeatureSwitches = {}) {
  return {
    aiConfigured,
    switches,
    available: AI_FEATURE_KEYS.filter(f => f !== 'prCodeReview'),
    effective: resolveAiFeatures(switches, aiConfigured),
  }
}

function renderSection() {
  return render(<AiFeaturesSection />)
}

const sw = (id: string) =>
  document.getElementById(`ai-switch-input-${id}`) as HTMLButtonElement

beforeEach(() => {
  mutate.mockReset()
})

it('without a model: says how to configure one and every switch is off and disabled', () => {
  mockStatus = status(false)
  renderSection()
  expect(screen.getByTestId('ai-features-not-configured').textContent).toMatch(
    'AI_GATEWAY_API_KEY'
  )
  const switches = screen.getAllByRole('switch')
  expect(switches.every(s => (s as HTMLButtonElement).disabled)).toBe(true)
  expect(
    switches.every(s => s.getAttribute('data-state') === 'unchecked')
  ).toBe(true)
  fireEvent.click(sw('master'))
  expect(mutate).not.toHaveBeenCalled()
})

it('with a model: all on by default, and no plugin feature without the plugin', () => {
  mockStatus = status(true)
  renderSection()
  expect(screen.queryByTestId('ai-features-not-configured')).toBeNull()
  expect(sw('master').getAttribute('data-state')).toBe('checked')
  expect(sw('feature-turnSummary').getAttribute('data-state')).toBe('checked')
  expect(sw('feature-prCodeReview')).toBeNull()
})

it('a group switched off shows its features off and disabled; other groups stay on', () => {
  mockStatus = status(true, { groups: { summaries: false } })
  renderSection()
  expect(sw('group-summaries').getAttribute('data-state')).toBe('unchecked')
  expect(sw('feature-runSummary').disabled).toBe(true)
  expect(sw('feature-runSummary').getAttribute('data-state')).toBe('unchecked')
  expect(sw('feature-memoryRanking').disabled).toBe(false)
  expect(sw('feature-memoryRanking').getAttribute('data-state')).toBe('checked')
})

it('clicking a feature writes that one switch', () => {
  mockStatus = status(true)
  renderSection()
  fireEvent.click(sw('feature-duplicateCheck'))
  expect(mutate).toHaveBeenCalledWith(
    { key: { level: 'feature', key: 'duplicateCheck' }, enabled: false },
    expect.anything()
  )
  fireEvent.click(sw('group-memory'))
  expect(mutate).toHaveBeenLastCalledWith(
    { key: { level: 'group', key: 'memory' }, enabled: false },
    expect.anything()
  )
})
