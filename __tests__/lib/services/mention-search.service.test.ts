jest.mock('@/lib/repositories/mention-search.repository', () => ({
  mentionSearchRepository: {
    searchTasks: jest.fn().mockResolvedValue([
      {
        id: 't1',
        number: 42,
        title: 'Fix bug',
        status: 'IN_PROGRESS',
        team: { identifier: 'LUM' },
      },
    ]),
    searchSprints: jest
      .fn()
      .mockResolvedValue([
        { id: 's1', number: 14, name: 'Tokens', status: 'ACTIVE' },
      ]),
    searchProjects: jest.fn().mockResolvedValue([{ id: 'p1', name: 'Lumo' }]),
    searchMilestones: jest
      .fn()
      .mockResolvedValue([
        { id: 'm1', name: 'v1', slug: 'v1', project: { name: 'Lumo' } },
      ]),
  },
}))
import { mentionSearchService } from '@/lib/services/mention-search.service'
import { mentionSearchRepository } from '@/lib/repositories/mention-search.repository'

it('maps all four kinds to MentionSearchItem with hrefs', async () => {
  const items = await mentionSearchService.search('ws1', 'acme', 'x', 5)
  const byKind = Object.fromEntries(items.map(i => [i.kind, i]))
  expect(byKind.task).toMatchObject({
    kind: 'task',
    id: 't1',
    label: 'LUM-42',
    sublabel: 'Fix bug',
    status: 'IN_PROGRESS',
    href: '/workspace/acme/tasks/LUM-42',
  })
  expect(byKind.sprint).toMatchObject({
    kind: 'sprint',
    label: 'Sprint 14',
    href: '/workspace/acme/sprints/14',
  })
  expect(byKind.project).toMatchObject({
    kind: 'project',
    label: 'Lumo',
    href: '/workspace/acme/projects/lumo',
  })
  expect(byKind.milestone).toMatchObject({
    kind: 'milestone',
    label: 'v1',
    href: '/workspace/acme/projects/lumo/milestones/v1',
  })
})

it('returns recent entities for a blank query (bare @) instead of []', async () => {
  const items = await mentionSearchService.search('ws1', 'acme', '   ', 5)
  // Blank/whitespace query → trimmed to '' → repos queried with '' (recent),
  // and the mapped results are returned rather than an empty list.
  expect(items.length).toBeGreaterThan(0)
  expect(mentionSearchRepository.searchTasks).toHaveBeenCalledWith('ws1', '', 5)
  expect(items.map(i => i.kind)).toEqual(
    expect.arrayContaining(['task', 'sprint', 'project', 'milestone'])
  )
})
