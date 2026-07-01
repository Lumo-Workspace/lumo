const team = { create: jest.fn().mockResolvedValue({ id: 'team1' }) }
const tx = {
  workspace: { create: jest.fn().mockResolvedValue({ id: 'ws1' }) },
  team,
  workspaceMember: { create: jest.fn().mockResolvedValue({ id: 'm1' }) },
  teamMember: { create: jest.fn().mockResolvedValue({}) },
  actor: { create: jest.fn().mockResolvedValue({}) },
  agentProfile: { create: jest.fn().mockResolvedValue({ id: 'a1' }) },
}
jest.mock('@/lib/db/prisma', () => ({
  prisma: { $transaction: (fn: (t: unknown) => unknown) => fn(tx) },
}))
jest.mock('@/lib/team', () => ({ generateIdentifier: () => 'CORE' }))

import { workspaceRepository } from '@/lib/repositories/workspace.repository'

test('team is created with the provided creator timezone', async () => {
  await workspaceRepository.create({
    name: 'Core',
    slug: 'core',
    clerkId: 'u1',
    timezone: 'Asia/Shanghai',
  })
  expect(team.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ timezone: 'Asia/Shanghai' }),
    })
  )
})

test('falls back to Pacific when timezone is missing or invalid', async () => {
  team.create.mockClear()
  await workspaceRepository.create({
    name: 'Core',
    slug: 'core',
    clerkId: 'u1',
  })
  expect(team.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ timezone: 'America/Los_Angeles' }),
    })
  )
})
