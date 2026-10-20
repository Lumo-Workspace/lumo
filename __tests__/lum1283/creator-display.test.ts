/**
 * @jest-environment node
 *
 * LUM-1283: the task detail's creator value is resolved from the task's
 * createdBy member against the workspace member list. The creator is always a
 * user — there is no agent branch.
 */
import { resolveCreatorDisplay } from '@/app/workspace/[workspaceUrl]/components/fields/creator-display'

const members = [
  { id: 'wm-a', name: 'Alice', imageUrl: 'https://img/a.png' },
  { id: 'wm-p', name: 'Pending', imageUrl: null },
]

describe('resolveCreatorDisplay', () => {
  it('resolves the creating member to its name and avatar', () => {
    expect(resolveCreatorDisplay({ id: 'wm-a' }, members)).toEqual({
      kind: 'member',
      name: 'Alice',
      imageUrl: 'https://img/a.png',
    })
  })

  it('marks a creator who is no longer a listed member', () => {
    expect(resolveCreatorDisplay({ id: 'wm-gone' }, members)).toEqual({
      kind: 'former-member',
    })
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
