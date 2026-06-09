import { membersToMentionItems } from '@/app/workspace/[workspaceUrl]/components/mention-types'

it('maps WorkspaceMemberInfo to user MentionItems (clerkId as id), skips agent placeholder', () => {
  const items = membersToMentionItems([
    {
      id: 'm1',
      clerkId: 'user_a',
      role: 'member',
      name: 'Alice',
      email: 'a@x.com',
      imageUrl: null,
      joinedAt: '',
      actorId: 'act1',
    },
    {
      id: 'm2',
      clerkId: '__agent__',
      role: 'member',
      name: 'Agent',
      email: null,
      imageUrl: null,
      joinedAt: '',
      actorId: null,
    },
  ] as any)
  expect(items).toEqual([
    { kind: 'user', id: 'user_a', label: 'Alice', imageUrl: null },
  ])
})
