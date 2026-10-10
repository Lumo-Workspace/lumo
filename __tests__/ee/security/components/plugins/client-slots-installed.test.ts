/** @jest-environment jsdom */
/**
 * LUM-1062 — plugin half of __tests__/components/plugins/client-slots-lum1062.test.tsx
 * (split in LUM-1065): the installed client list is the security plugin, and
 * it fills every slot it filled before the split.
 */
jest.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}))

import { INSTALLED_CLIENT_PLUGINS } from '@/lib/plugins/installed.client'

describe('installed client plugins', () => {
  it('the security plugin fills every slot it filled before the split', () => {
    expect(INSTALLED_CLIENT_PLUGINS.map(p => p.id)).toEqual(['security'])
    expect(Object.keys(INSTALLED_CLIENT_PLUGINS[0]!.slots).sort()).toEqual([
      'settings.retention.row',
      'settings.workspace.section',
      'task.crossing.annotation',
      'task.dossier',
      'task.pullRequest.badge',
    ])
  })
})
