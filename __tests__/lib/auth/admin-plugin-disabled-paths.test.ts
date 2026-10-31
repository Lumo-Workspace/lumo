import {
  ADMIN_DISABLED_PATHS,
  lumoAdminPlugin,
} from '@/lib/auth/better-auth/admin-plugin'

describe('admin plugin disabled paths', () => {
  it('every admin plugin endpoint path is disabled', () => {
    const plugin = lumoAdminPlugin()
    const endpoints = Object.values(plugin.endpoints ?? {}) as Array<{
      path: string
    }>
    const paths = endpoints.map(e => e.path)

    expect(paths.length).toBeGreaterThan(5)
    for (const path of paths) {
      expect(ADMIN_DISABLED_PATHS).toContain(path)
    }
    // And no stale entry the plugin no longer serves.
    for (const path of ADMIN_DISABLED_PATHS) {
      expect(paths).toContain(path)
    }
    expect([...ADMIN_DISABLED_PATHS].sort()).toEqual([...paths].sort())
  })

  it('keeps the session.create.before ban hook', () => {
    const plugin = lumoAdminPlugin() as unknown as {
      init: () => {
        options: {
          databaseHooks: { session: { create: { before: unknown } } }
        }
      }
    }
    const { options } = plugin.init()
    expect(typeof options.databaseHooks.session.create.before).toBe('function')
  })
})
