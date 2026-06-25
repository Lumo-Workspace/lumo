/** @jest-environment jsdom */
/**
 * LUM-590: crossingFieldsFor is a pure helper that maps a crossing with
 * policyRuleText to a three-field display object. Tested directly without
 * rendering any UI (avoids the jsdom / Radix / react-intl trap).
 */

// Mocks must be declared before imports when the module under test drags in
// client-side deps (react-intl, sonner, api-client) that are ESM-only or need
// a provider. The pure helper itself has no runtime deps on these.
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({
      defaultMessage,
    }: {
      id: string
      defaultMessage?: string
    }) => defaultMessage ?? '',
  }),
}))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useBoundaryCrossings', () => ({
  useBoundaryCrossings: jest.fn().mockReturnValue({
    crossings: [],
    loading: false,
    error: null,
    refresh: jest.fn(),
  }),
}))
jest.mock('@/lib/api-client', () => ({
  tasksClient: {
    dispositionBoundaryCrossing: jest.fn(),
    spawnBoundaryRemediation: jest.fn(),
  },
}))

import { crossingFieldsFor } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/BoundaryCrossingsPanel'

describe('crossingFieldsFor (LUM-590)', () => {
  it('returns three fields when policyRuleText is set', () => {
    const result = crossingFieldsFor({
      policyRuleText: 'No npm installs',
      detail: 'npm install lodash',
      agentContext: 'installing a utility library',
    })
    expect(result).not.toBeNull()
    expect(result!.rule).toBe('No npm installs')
    expect(result!.triggeredBy).toBe('npm install lodash')
    expect(result!.whatHappened).toBe('installing a utility library')
  })

  it('omits whatHappened when agentContext is null', () => {
    const result = crossingFieldsFor({
      policyRuleText: 'No npm installs',
      detail: 'npm install lodash',
      agentContext: null,
    })
    expect(result).not.toBeNull()
    expect(result!.whatHappened).toBeNull()
  })

  it('returns null when policyRuleText is null (non-project-rule crossing)', () => {
    const result = crossingFieldsFor({
      policyRuleText: null,
      detail: 'some command',
      agentContext: null,
    })
    expect(result).toBeNull()
  })

  it('returns null when policyRuleText is empty string', () => {
    const result = crossingFieldsFor({
      policyRuleText: '',
      detail: 'some command',
      agentContext: null,
    })
    expect(result).toBeNull()
  })
})
