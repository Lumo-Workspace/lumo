/** @jest-environment jsdom */
/**
 * LUM-590 Task 8: advisoryLabelFor is a pure helper that returns 'advisory'
 * for advisory crossings and null for blocking ones. Tested directly without
 * rendering any UI (avoids the jsdom / Radix / react-intl trap).
 */

// Mocks must be declared before imports when the module under test drags in
// client-side deps (react-intl, sonner, api-client) that are ESM-only or need
// a provider. The pure helper itself has no runtime deps on these — the mocks
// just let Jest load the module without throwing on their imports.
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

import { advisoryLabelFor } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/BoundaryCrossingsPanel'

test('advisory crossing yields the advisory label, blocking yields none', () => {
  expect(advisoryLabelFor({ advisory: true } as never)).toBe('advisory')
  expect(advisoryLabelFor({ advisory: false } as never)).toBeNull()
})
