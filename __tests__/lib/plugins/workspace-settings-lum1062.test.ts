/**
 * @jest-environment node
 *
 * LUM-1062 — the `workspaceSettings` extension point (RFC LUM-1058 §3.4
 * 设置页, §4 option A): every Workspace column is owned by the core or by an
 * installed plugin; owned columns are served and written, unowned ones are
 * neither. (With the security plugin installed: the plugin half,
 * __tests__/ee/security/lib/plugins/workspace-settings-installed.test.ts —
 * split in LUM-1065, because the open-source snapshot installs no plugin.)
 */
import type { LumoServerPlugin } from '@/lib/plugins/types'

type SettingsModule = typeof import('@/lib/plugins/workspace-settings')

/** The settings module over an explicit plugin list (fresh registry). */
function withPlugins(plugins: readonly LumoServerPlugin[]): SettingsModule {
  let mod: SettingsModule | undefined
  jest.isolateModules(() => {
    jest.doMock('@/lib/plugins/installed', () => ({
      INSTALLED_SERVER_PLUGINS: plugins,
    }))
    mod = require('@/lib/plugins/workspace-settings')
  })
  return mod as SettingsModule
}

afterEach(() => {
  jest.dontMock('@/lib/plugins/installed')
})

describe('no plugin installed', () => {
  const settings = withPlugins([])

  it('serves only the core columns and no plugin fields', () => {
    const row = {
      id: 'w1',
      name: 'Acme',
      aiDerivedContentEnabled: true,
      securityScanEnabled: true,
      securityPolicy: null,
      scanEvidenceRetentionDays: 7,
    }
    expect(settings.serializeWorkspaceSettings(row)).toEqual({
      id: 'w1',
      name: 'Acme',
      aiDerivedContentEnabled: true,
    })
    expect(settings.pluginMeFields()).toEqual({})
  })

  it('names the plugin columns of a write as unowned and never writes them', () => {
    expect(
      settings.unownedWorkspaceColumns({
        name: 'Acme',
        securityScanEnabled: false,
        scanEvidenceRetentionDays: 0,
        notAColumn: 1,
      })
    ).toEqual(['securityScanEnabled', 'scanEvidenceRetentionDays'])
    expect(
      settings.pluginWorkspaceWrites({ securityScanEnabled: false })
    ).toEqual({})
    const parsed = settings
      .workspaceSettingsUpdateSchema()
      .safeParse({ name: 'Acme', securityScanEnabled: false })
    expect(parsed.success && parsed.data).toEqual({ name: 'Acme' })
  })

  it('AI review is on (the column default) when no plugin owns the switch', async () => {
    await expect(settings.isWorkspaceAiReviewEnabled('w1')).resolves.toBe(true)
  })
})

describe('contributor rules', () => {
  const plugin = (
    id: string,
    columns: string[],
    aiReviewEnabled?: () => Promise<boolean>
  ): LumoServerPlugin => ({
    id,
    register(api) {
      api.workspaceSettings({
        key: id,
        columns: Object.fromEntries(
          columns.map(c => [c, require('zod').z.boolean().optional()])
        ),
        ...(aiReviewEnabled ? { aiReviewEnabled } : {}),
      })
    },
  })

  it('refuses a column two plugins claim, or a core column', () => {
    expect(() =>
      withPlugins([
        plugin('a', ['x']),
        plugin('b', ['x']),
      ]).pluginWorkspaceColumns()
    ).toThrow(/already owned/)
    expect(() =>
      withPlugins([plugin('a', ['name'])]).pluginWorkspaceColumns()
    ).toThrow(/already owned/)
  })

  it('plugin GET fields never replace a core field', () => {
    const s = withPlugins([
      {
        id: 'p',
        register(api) {
          api.workspaceSettings({
            key: 'p',
            columns: {},
            meFields: () => ({ role: 'OWNER', extra: 1 }),
          })
        },
      },
    ])
    expect(s.pluginMeFields(['workspace', 'role'])).toEqual({ extra: 1 })
  })

  it('AI review is off when any contributor says so', async () => {
    const on = jest.fn(async () => true)
    const off = jest.fn(async () => false)
    const s = withPlugins([plugin('a', ['x'], on), plugin('b', ['y'], off)])
    await expect(s.isWorkspaceAiReviewEnabled('w1')).resolves.toBe(false)
    expect(on).toHaveBeenCalledWith('w1')
    expect(off).toHaveBeenCalledWith('w1')
  })

  it('maps owned values through the owner’s toColumnWrite, leaving the rest alone (LUM-1065)', () => {
    const s = withPlugins([
      {
        id: 'p',
        register(api) {
          api.workspaceSettings({
            key: 'p',
            columns: {
              jsonCol: require('zod').z.unknown(),
              flag: require('zod').z.boolean(),
            },
            toColumnWrite: (column, value) =>
              column === 'jsonCol' && value === null ? 'SQL-NULL' : value,
          })
        },
      },
    ])
    expect(
      s.toWorkspaceColumnWrites({ name: 'A', jsonCol: null, flag: false })
    ).toEqual({ name: 'A', jsonCol: 'SQL-NULL', flag: false })
    // An absent or undefined owned value is not mapped (nothing is written).
    expect(s.toWorkspaceColumnWrites({ name: 'A' })).toEqual({ name: 'A' })
    expect(withPlugins([]).toWorkspaceColumnWrites({ jsonCol: null })).toEqual({
      jsonCol: null,
    })
  })

  it('merges each plugin’s audited columns into the core actions, and only owned ones (LUM-1065)', () => {
    const { AUDITED_WORKSPACE_SETTINGS } =
      require('@/lib/audit/workspace-settings') as typeof import('@/lib/audit/workspace-settings')
    expect(withPlugins([]).auditedWorkspaceSettings()).toEqual(
      AUDITED_WORKSPACE_SETTINGS
    )
    const audited = (cols: string[]): LumoServerPlugin => ({
      id: 'p',
      register(api) {
        api.workspaceSettings({
          key: 'p',
          columns: { x: require('zod').z.boolean().optional() },
          audit: { 'workspace.retention_updated': cols },
        })
      },
    })
    const merged = withPlugins([audited(['x'])]).auditedWorkspaceSettings()
    expect(merged['workspace.retention_updated']).toEqual([
      ...AUDITED_WORKSPACE_SETTINGS['workspace.retention_updated'],
      'x',
    ])
    expect(merged['workspace.settings_updated']).toEqual(
      AUDITED_WORKSPACE_SETTINGS['workspace.settings_updated']
    )
    expect(() =>
      withPlugins([audited(['name'])]).auditedWorkspaceSettings()
    ).toThrow(/does not own/)
  })
})
