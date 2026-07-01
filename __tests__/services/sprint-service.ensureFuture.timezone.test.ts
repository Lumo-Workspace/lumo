import { sprintService } from '@/lib/services/sprint.service'

jest.mock('@/lib/repositories/team.repository', () => ({
  teamRepository: { findSprintCadenceConfig: jest.fn() },
}))
jest.mock('@/lib/repositories/sprint.repository', () => ({
  sprintRepository: {
    listByTeam: jest.fn().mockResolvedValue([]),
    nextNumberForTeam: jest.fn().mockResolvedValue(1),
    create: jest.fn().mockResolvedValue({}),
  },
}))
// Avoid pulling in the ai-sdk gateway chain (TransformStream is not defined
// under jsdom) — same workaround as __tests__/sprint.service.test.ts.
jest.mock('@/lib/services/sprint-summary.service', () => ({
  sprintSummaryService: {
    generate: jest.fn().mockResolvedValue(undefined),
  },
}))
jest.mock('@/lib/services/sprint-notifications.service', () => ({
  dispatchSprintNotification: jest.fn().mockResolvedValue(undefined),
}))

import { teamRepository } from '@/lib/repositories/team.repository'
import { sprintRepository } from '@/lib/repositories/sprint.repository'

test('ensureFutureSprints creates a sprint starting at the team timezone Monday', async () => {
  ;(teamRepository.findSprintCadenceConfig as jest.Mock).mockResolvedValue({
    id: 't1',
    sprintsEnabled: true,
    sprintDurationDays: 14,
    sprintCooldownDays: 0,
    sprintStartWeekday: 1,
    sprintAutoCreate: 1,
    timezone: 'America/Los_Angeles',
  })
  await sprintService.ensureFutureSprints(
    't1',
    new Date('2026-07-01T20:00:00Z')
  )
  expect(sprintRepository.create).toHaveBeenCalledWith(
    expect.objectContaining({
      startDate: new Date('2026-07-06T07:00:00.000Z'),
      endDate: new Date('2026-07-19T07:00:00.000Z'),
    })
  )
})
