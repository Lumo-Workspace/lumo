/**
 * @jest-environment node
 *
 * LUM-1230: `lumo task create|update --milestone <ref>` resolves the slug (the
 * web URL segment) as well as the name and the id; a shared name is an error
 * listing the candidates by slug instead of silently taking the first.
 */
// Same heavy-graph stubs as task-cli.service.test.ts.
jest.mock('@/lib/services/task.service', () => ({
  taskService: { createTask: jest.fn() },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: { findForMemberWithBinding: jest.fn() },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { findByProject: jest.fn() },
}))

import { taskCliService } from '@/lib/services/task-cli.service'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'

const findByProject = milestoneRepository.findByProject as jest.Mock

const HEADLESS = {
  id: 'cmv95ivuj000l06jvjrs7b7z1',
  name: 'Headless 化(一):Web 展示信息 CLI 化',
  slug: 'headless-web-cli',
}

beforeEach(() => jest.clearAllMocks())

describe('taskCliService.resolveMilestoneId', () => {
  it('resolves the slug', async () => {
    findByProject.mockResolvedValue([HEADLESS])
    await expect(
      taskCliService.resolveMilestoneId('p-1', 'headless-web-cli')
    ).resolves.toBe(HEADLESS.id)
  })

  it('still resolves the name (case-insensitive) and the id', async () => {
    findByProject.mockResolvedValue([HEADLESS])
    await expect(
      taskCliService.resolveMilestoneId('p-1', HEADLESS.name.toUpperCase())
    ).resolves.toBe(HEADLESS.id)
    await expect(
      taskCliService.resolveMilestoneId('p-1', HEADLESS.id)
    ).resolves.toBe(HEADLESS.id)
  })

  it('rejects a shared name with the candidate slugs (was: first match)', async () => {
    findByProject.mockResolvedValue([
      { id: 'm-1', name: 'Beta', slug: 'beta' },
      { id: 'm-2', name: 'Beta', slug: 'beta-2' },
    ])
    const err = (await taskCliService
      .resolveMilestoneId('p-1', 'Beta')
      .catch((e: unknown) => e)) as Error & { status?: number }
    expect(err.status).toBe(400)
    expect(err.message).toContain('beta ("Beta")')
    expect(err.message).toContain('beta-2 ("Beta")')
  })

  it('400 when nothing matches', async () => {
    findByProject.mockResolvedValue([HEADLESS])
    await expect(
      taskCliService.resolveMilestoneId('p-1', 'nope')
    ).rejects.toMatchObject({ status: 400 })
  })
})
