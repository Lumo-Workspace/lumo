import { formatSyncedLine } from '@/cli/src/commands/doc-sync'

describe('formatSyncedLine', () => {
  it('reports the synced doc', () => {
    expect(formatSyncedLine({ id: 'cmd_1', title: 'Spec' })).toBe(
      'Synced cmd_1 "Spec" from Google'
    )
  })
})
