/**
 * @jest-environment node
 *
 * LUM-1062 — the `workspaceSettings` extension point (RFC LUM-1058 §3.4
 * 设置页, §4 option A): every Workspace column is owned by the core or by an
 * installed plugin; owned columns are served and written, unowned ones are
 * neither.
 */
import type { LumoServerPlugin } from '@/lib/plugins/types'

const SECURITY_COLUMNS = [
  'securityPolicy',
  'scanEvidenceRetentionDays',
  'securityScanEnabled',
  'securityAiReviewEnabled',
  'securityHuntEnabled',
]

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

describe('installed (the security plugin)', () => {
  const settings = require('@/lib/plugins/workspace-settings') as SettingsModule
  const { WORKSPACE_COLUMNS } =
    require('@/lib/repositories/workspace-columns') as typeof import('@/lib/repositories/workspace-columns')

  it('every Workspace column is owned exactly once: by the core or the plugin', () => {
    const owned = [
      ...settings.CORE_WORKSPACE_COLUMNS,
      ...Object.keys(settings.pluginWorkspaceColumns()),
    ]
    expect(new Set(owned).size).toBe(owned.length)
    expect([...owned].sort()).toEqual([...WORKSPACE_COLUMNS].sort())
    expect(Object.keys(settings.pluginWorkspaceColumns()).sort()).toEqual(
      [...SECURITY_COLUMNS].sort()
    )
  })

  it('serves the whole row, with the platform ceiling, as before the split', () => {
    const row = Object.fromEntries(WORKSPACE_COLUMNS.map(c => [c, `v-${c}`]))
    expect(settings.serializeWorkspaceSettings(row)).toEqual(row)
    expect(Object.keys(settings.pluginMeFields())).toEqual(['securityPlatform'])
    expect(
      settings.unownedWorkspaceColumns({ securityScanEnabled: false })
    ).toEqual([])
  })

  it('validates and writes the owned columns with the pre-split validators', () => {
    const schema = settings.workspaceSettingsUpdateSchema()
    expect(schema.safeParse({ securityScanEnabled: false }).success).toBe(true)
    expect(schema.safeParse({ securityScanEnabled: 'no' }).success).toBe(false)
    expect(schema.safeParse({ scanEvidenceRetentionDays: 14 }).success).toBe(
      true
    )
    expect(schema.safeParse({ scanEvidenceRetentionDays: 3 }).success).toBe(
      false
    )
    expect(schema.safeParse({ securityPolicy: null }).success).toBe(true)
    expect(
      schema.safeParse({
        securityPolicy: {
          block: [{ provenance: 'LLM_JUDGE', severity: 'HIGH' }],
        },
      }).success
    ).toBe(false)
    expect(
      settings.pluginWorkspaceWrites({
        name: 'Acme',
        securityHuntEnabled: false,
        securityScanEnabled: undefined,
      })
    ).toEqual({ securityHuntEnabled: false })
  })
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

  it('AI review is off when any contributor says so', async () => {
    const on = jest.fn(async () => true)
    const off = jest.fn(async () => false)
    const s = withPlugins([plugin('a', ['x'], on), plugin('b', ['y'], off)])
    await expect(s.isWorkspaceAiReviewEnabled('w1')).resolves.toBe(false)
    expect(on).toHaveBeenCalledWith('w1')
    expect(off).toHaveBeenCalledWith('w1')
  })
})
