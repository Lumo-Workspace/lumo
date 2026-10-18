/**
 * @jest-environment node
 *
 * LUM-1062 / LUM-1065 — the `workspaceSettings` extension point with the
 * security plugin installed (the plugin half of
 * __tests__/lib/plugins/workspace-settings-lum1062.test.ts): the plugin owns
 * its six Workspace columns (LUM-1130 added the request-changes workflow), validates them with the pre-split validators,
 * clears the policy Json column to SQL NULL, and audits its columns under
 * the same actions as before the split.
 */
import { Prisma } from '@prisma/client'
import * as settings from '@/lib/plugins/workspace-settings'
import { WORKSPACE_COLUMNS } from '@/lib/repositories/workspace-columns'
import { AUDITED_WORKSPACE_SETTINGS } from '@/lib/audit/workspace-settings'

const SECURITY_COLUMNS = [
  'securityPolicy',
  'scanEvidenceRetentionDays',
  'securityScanEnabled',
  'securityAiReviewEnabled',
  'securityHuntEnabled',
  // LUM-1234: the reward-hack layer switch.
  'securityRewardHackEnabled',
  // LUM-1130: the request-changes workflow.
  'securityRequestChangesEnabled',
  // LUM-1142: the PR's author may resolve / approve by command.
  'securityAllowAuthorApproval',
  // LUM-1134: the learnings scope.
  'securityLearningsScope',
  // LUM-1137: pause automatic review after N reviewed commits.
  'securityReviewAutoPauseAfter',
]

describe('installed (the security plugin)', () => {
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
  })

  it("LUM-1234: the platform ceiling it serves is the viewing workspace's", () => {
    const saved = { ...process.env }
    process.env.LUMO_REWARD_HACK = 'on'
    process.env.LUMO_REWARD_HACK_WORKSPACES = 'ws-listed'
    try {
      const platform = (id: string) =>
        (
          settings.pluginMeFields([], id).securityPlatform as {
            rewardHack: boolean
          }
        ).rewardHack
      expect(platform('ws-listed')).toBe(true)
      expect(platform('ws-other')).toBe(false)
    } finally {
      process.env = saved
    }
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
    // LUM-1134: the learnings scope is one of three values.
    for (const v of ['local', 'global', 'auto'])
      expect(schema.safeParse({ securityLearningsScope: v }).success).toBe(true)
    expect(schema.safeParse({ securityLearningsScope: 'org' }).success).toBe(
      false
    )
    // LUM-1137: the pause-after is a whole number 0–100 (0 = never).
    for (const v of [0, 5, 100])
      expect(
        schema.safeParse({ securityReviewAutoPauseAfter: v }).success
      ).toBe(true)
    for (const v of [-1, 101, 1.5])
      expect(
        schema.safeParse({ securityReviewAutoPauseAfter: v }).success
      ).toBe(false)
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

  it('LUM-1065: a cleared policy is written as SQL NULL (Prisma.DbNull), as the core repository did before', () => {
    expect(
      settings.toWorkspaceColumnWrites({ name: 'A', securityPolicy: null })
    ).toEqual({ name: 'A', securityPolicy: Prisma.DbNull })
    const policy = { block: [] }
    expect(
      settings.toWorkspaceColumnWrites({
        securityPolicy: policy,
        securityHuntEnabled: false,
      })
    ).toEqual({ securityPolicy: policy, securityHuntEnabled: false })
  })

  it('LUM-1065: audits the plugin columns under the pre-split actions', () => {
    const audited = settings.auditedWorkspaceSettings()
    expect(
      [...(audited['workspace.security_settings_updated'] ?? [])].sort()
    ).toEqual(
      [
        ...AUDITED_WORKSPACE_SETTINGS['workspace.security_settings_updated'],
        'securityPolicy',
        'securityScanEnabled',
        'securityAiReviewEnabled',
        'securityHuntEnabled',
        'securityRewardHackEnabled',
        'securityRequestChangesEnabled',
        'securityAllowAuthorApproval',
        'securityLearningsScope',
        'securityReviewAutoPauseAfter',
      ].sort()
    )
    expect(audited['workspace.retention_updated']).toContain(
      'scanEvidenceRetentionDays'
    )
  })
})
