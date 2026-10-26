// LUM-1281 — the summary read does not retry a 404 ("retro not generated
// yet"), so a closed sprint's outcome cards are not held back by retries.
jest.mock('@/lib/api-client', () => ({
  ...jest.requireActual('@/lib/api-client/base'),
  sprintsClient: {},
  tasksClient: {},
}))

import { ApiClientError } from '@/lib/api-client/base'
import { retrySummaryRead } from '@/app/workspace/[workspaceUrl]/hooks/useSprints'

test('a 404 is final', () => {
  expect(
    retrySummaryRead(0, new ApiClientError('Retro not generated yet', 404))
  ).toBe(false)
})

test('other failures keep the default three retries', () => {
  const err = new ApiClientError('boom', 500)
  expect(retrySummaryRead(0, err)).toBe(true)
  expect(retrySummaryRead(2, err)).toBe(true)
  expect(retrySummaryRead(3, err)).toBe(false)
  expect(retrySummaryRead(0, new Error('network'))).toBe(true)
})
