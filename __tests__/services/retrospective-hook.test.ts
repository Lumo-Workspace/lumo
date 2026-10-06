/** @jest-environment node */
const waitUntil = jest.fn((p: Promise<unknown>) => p)
jest.mock('@/lib/runtime/wait-until', () => ({
  waitUntil: (p: Promise<unknown>) => waitUntil(p),
}))
jest.mock('@/lib/repositories/retrospective.repository', () => ({
  retrospectiveRepository: {
    findSnapshot: jest.fn().mockResolvedValue({ capturedAt: new Date() }),
    createSnapshotIfAbsent: jest.fn(),
    loadActuals: jest.fn(),
    countReferenceLibrary: jest.fn(),
  },
}))
jest.mock('@/lib/services/forecast.service', () => ({
  forecastService: { getTaskForecast: jest.fn() },
}))

import { captureRetrospectiveSnapshotInBackground } from '@/lib/services/retrospective.service'
import { retrospectiveRepository } from '@/lib/repositories/retrospective.repository'

it('schedules captureSnapshot via waitUntil', async () => {
  captureRetrospectiveSnapshotInBackground('t1')
  expect(waitUntil).toHaveBeenCalledTimes(1)
  await Promise.resolve()
  expect(retrospectiveRepository.findSnapshot).toHaveBeenCalledWith('t1')
})
