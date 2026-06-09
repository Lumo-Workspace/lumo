import { mentionSearchClient } from '@/lib/api-client/mention-search'

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      items: [{ kind: 'task', id: 't1', label: 'LUM-1', href: '/x' }],
    }),
  }) as any
})

it('calls the endpoint with encoded query + limit and returns items', async () => {
  const items = await mentionSearchClient.search('a b', 5)
  const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string
  expect(calledUrl).toContain('/api/workspaces/mention-search')
  expect(calledUrl).toContain('q=a+b')
  expect(calledUrl).toContain('limit=5')
  expect(items).toHaveLength(1)
})
