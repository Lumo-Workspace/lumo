/**
 * @jest-environment node
 *
 * LUM-1283: the task detail's "Created by" value is resolved from the task's
 * createdBy actor against the workspace member list.
 */
import { resolveCreatorDisplay } from '@/app/workspace/[workspaceUrl]/components/fields/creator-display'

const members = [
  { actorId: 'actor-h', name: 'Alice', imageUrl: 'https://img/a.png' },
  { actorId: null, name: 'Pending', imageUrl: null },
]

describe('resolveCreatorDisplay', () => {
  it('resolves a human creator to the member name and avatar', () => {
    expect(
      resolveCreatorDisplay(
        { id: 'actor-h', type: 'HUMAN', member: null, agent: null },
        members
      )
    ).toEqual({ kind: 'member', name: 'Alice', imageUrl: 'https://img/a.png' })
  })

  it('resolves an agent creator to its agent name', () => {
    expect(
      resolveCreatorDisplay(
        {
          id: 'actor-a',
          type: 'AGENT',
          agent: { id: 'ag', name: 'Coding Agent', avatarColor: '#000' },
        },
        members
      )
    ).toEqual({ kind: 'agent', name: 'Coding Agent' })
  })

  it('leaves an unnamed agent creator without a name for the localized label', () => {
    expect(
      resolveCreatorDisplay(
        { id: 'actor-a', type: 'AGENT', agent: null },
        members
      )
    ).toEqual({ kind: 'agent', name: null })
  })

  it('marks a human creator who is no longer a listed member', () => {
    expect(
      resolveCreatorDisplay({ id: 'actor-gone', type: 'HUMAN' }, members)
    ).toEqual({ kind: 'former-member' })
  })

  it('reads a missing creator as unrecorded', () => {
    expect(resolveCreatorDisplay(null, members)).toEqual({
      kind: 'unrecorded',
    })
    expect(resolveCreatorDisplay(undefined, members)).toEqual({
      kind: 'unrecorded',
    })
  })
})
