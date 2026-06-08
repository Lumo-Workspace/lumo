import { buildMentionSuggestion } from '@/app/workspace/[workspaceUrl]/components/mention-suggestion'
import type { MentionSources } from '@/types/mention'

function makeSources(): MentionSources {
  return {
    members: [
      { kind: 'user', id: 'u1', label: 'Alice', imageUrl: null },
      { kind: 'user', id: 'u2', label: 'Bob', imageUrl: null },
    ],
    searchEntities: jest
      .fn()
      .mockResolvedValue([
        {
          kind: 'task',
          id: 't1',
          label: 'LUM-1',
          sublabel: 'Fix',
          status: 'TODO',
          href: '/x',
        },
      ]),
  }
}

it('items() returns matching users synchronously', () => {
  const cfg = buildMentionSuggestion(
    makeSources(),
    jest.fn(),
    jest.fn(),
    jest.fn(),
    { current: null }
  )
  const items = (cfg.items as any)({ query: 'ali' })
  expect(items).toEqual([
    { kind: 'user', id: 'u1', label: 'Alice', imageUrl: null },
  ])
})

it('debounced entity search resolves into onUpdate', async () => {
  jest.useFakeTimers()
  const onUpdate = jest.fn()
  const sources = makeSources()
  const cfg = buildMentionSuggestion(sources, jest.fn(), onUpdate, jest.fn(), {
    current: null,
  })
  const render = (cfg.render as any)()
  const fakeRect = {
    top: 0,
    left: 0,
    bottom: 0,
    right: 0,
    width: 0,
    height: 0,
  } as DOMRect
  render.onStart({
    query: 'lum',
    clientRect: () => fakeRect,
    command: jest.fn(),
    items: [],
  })
  jest.advanceTimersByTime(250)
  await Promise.resolve()
  await Promise.resolve()
  expect(sources.searchEntities).toHaveBeenCalledWith('lum')
  jest.useRealTimers()
})
