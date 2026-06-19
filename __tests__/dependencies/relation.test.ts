import { relationToEdge } from '@/app/workspace/[workspaceUrl]/dependencies/relation'

describe('relationToEdge', () => {
  it('maps BLOCKED_BY to a BLOCKS edge directed BLOCKED_BY', () => {
    expect(relationToEdge('BLOCKED_BY')).toEqual({
      kind: 'BLOCKS',
      direction: 'BLOCKED_BY',
    })
  })

  it('maps BLOCKS to a BLOCKS edge directed BLOCKS', () => {
    expect(relationToEdge('BLOCKS')).toEqual({
      kind: 'BLOCKS',
      direction: 'BLOCKS',
    })
  })

  it('maps RELATES to a RELATES edge with ignored default direction', () => {
    expect(relationToEdge('RELATES')).toEqual({
      kind: 'RELATES',
      direction: 'BLOCKED_BY',
    })
  })
})
