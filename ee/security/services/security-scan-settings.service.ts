import { miscRepository } from '@/lib/repositories/misc.repository'
import {
  DEFAULT_WORKSPACE_SECURITY_SWITCHES,
  platformSecurityCeiling,
  resolveSecurityLayers,
  type EffectiveSecurityLayers,
  type PlatformSecurityCeiling,
  type WorkspaceSecuritySwitches,
} from '@/ee/security/security-scan/workspace-switches'
import { workspaceService } from '@/lib/services/workspace.service'
import {
  recordAuditEvent,
  type AuditContext,
} from '@/lib/services/audit.service'
import { securityColumnsRepository } from '@/ee/security/repositories/security-columns.repository'
import { waitUntil } from '@/lib/runtime/wait-until'
import {
  agentReviewBlocking,
  DEFAULT_SECURITY_POLICY,
  parseSecurityPolicy,
  withAgentReviewBlocking,
  type AgentReviewBlocking,
  type AgentReviewBlockingView,
  type SecurityPolicy,
} from '@/ee/security/security-scan/policy'

/**
 * LUM-1002 — the PR security-scan switches as one read/write unit, so the CLI
 * (`lumo workspace security-scan`) and the settings card speak the same
 * shape. Writes go through `workspaceService.updateWorkspace`, which keeps
 * the OWNER check and the LUM-907 audit event in one place.
 */

export interface SecurityScanSettings {
  /** What the workspace stored (a missing row reads as the defaults). */
  switches: WorkspaceSecuritySwitches
  /** What the platform env allows at all — the ceiling. */
  platform: PlatformSecurityCeiling
  /** Which layers will actually run: switches under the ceiling. */
  effective: EffectiveSecurityLayers
  /** Whether the caller may change the switches (OWNER) — lets the CLI refuse
   *  up front instead of asking for confirmation and then hitting a 403. */
  canEdit: boolean
  /** LUM-1329: which imported agent-review findings block Done — the
   *  `AGENT_REVIEW` entries of `Workspace.securityPolicy`. */
  agentReviewBlocking: AgentReviewBlockingView
}

/** The caller a read or write is made for. */
export interface SecurityScanSettingsCaller {
  workspaceId: string
  memberId: string
}

/** A partial switch change, or `all` to set every switch at once. */
export type SecurityScanSettingsUpdate =
  | (Partial<WorkspaceSecuritySwitches> & {
      all?: undefined
      /** LUM-1329: rewrites only the policy's `AGENT_REVIEW` entries. */
      agentReviewBlocking?: AgentReviewBlocking | undefined
    })
  | { all: boolean; agentReviewBlocking?: undefined }

/**
 * `all: false` = disable all, `all: true` = enable all — the four layer
 * switches (scan, AI review, hunt, reward-hack). `all` never touches the
 * request-changes workflow (LUM-1130), author approval (LUM-1142), the
 * learnings scope (LUM-1134) or the review pause-after (LUM-1137). Else as
 * given.
 */
export function switchesForUpdate(update: SecurityScanSettingsUpdate): {
  [K in keyof WorkspaceSecuritySwitches]?:
    | WorkspaceSecuritySwitches[K]
    | undefined
} {
  if (update.all !== undefined) {
    return {
      securityScanEnabled: update.all,
      securityAiReviewEnabled: update.all,
      securityHuntEnabled: update.all,
      securityRewardHackEnabled: update.all,
    }
  }
  return {
    securityScanEnabled: update.securityScanEnabled,
    securityAiReviewEnabled: update.securityAiReviewEnabled,
    securityHuntEnabled: update.securityHuntEnabled,
    // LUM-1234: the reward-hack layer ("Agent behavior").
    securityRewardHackEnabled: update.securityRewardHackEnabled,
    securityRequestChangesEnabled: update.securityRequestChangesEnabled,
    // LUM-1142: the PR's author may resolve / approve by command.
    securityAllowAuthorApproval: update.securityAllowAuthorApproval,
    // LUM-1134: the learnings scope (local | global | auto).
    securityLearningsScope: update.securityLearningsScope,
    // LUM-1137: pause automatic review after N reviewed commits (0 = never).
    securityReviewAutoPauseAfter: update.securityReviewAutoPauseAfter,
  }
}

/**
 * LUM-1140 — the bulk withdrawal, imported lazily so a settings read or a
 * plain switch change never loads the GitHub client.
 */
async function withdrawChangeRequests(workspaceId: string): Promise<void> {
  const { requestChangesOffService } =
    await import('@/ee/security/services/request-changes-off.service')
  await requestChangesOffService.withdrawAcrossWorkspace(workspaceId)
}

/**
 * LUM-1329 — the policy to write for `level` over the stored `raw` one: only
 * its `AGENT_REVIEW` entries replaced (every other entry kept); null (back
 * to following the default) when that is exactly the default; or undefined
 * (nothing written, nothing audited) when the level is already the stored
 * one.
 */
export function nextAgentReviewPolicy(
  raw: unknown,
  level: AgentReviewBlocking
): SecurityPolicy | null | undefined {
  const policy = parseSecurityPolicy(raw)
  if (agentReviewBlocking(policy) === level) return undefined
  const next = withAgentReviewBlocking(policy, level)
  // Both are built as { provenance, severity } in that key order.
  return JSON.stringify(next) === JSON.stringify(DEFAULT_SECURITY_POLICY)
    ? null
    : next
}

/** Compare-and-set rounds before a concurrent policy edit wins (409). */
const POLICY_WRITE_ATTEMPTS = 3

/**
 * LUM-1329 — write the agent-review level as a compare-and-set on the stored
 * policy, so an edit to other entries made meanwhile (e.g. a raw
 * `PATCH /api/workspaces/me`) is never overwritten: re-read and retry, then
 * 409. Called only after `update`'s OWNER check; audited
 * as its own plugin action (user ruling, LUM-1329 Decision 1): the plugin
 * may only write plugin actions, and this write skips updateWorkspace's.
 */
async function writeAgentReviewBlocking(
  workspaceId: string,
  level: AgentReviewBlocking,
  audit: AuditContext | undefined
): Promise<void> {
  for (let attempt = 0; attempt < POLICY_WRITE_ATTEMPTS; attempt++) {
    const raw = await securityColumnsRepository.findSecurityPolicy(workspaceId)
    const next = nextAgentReviewPolicy(raw, level)
    if (next === undefined) return
    if (
      await securityColumnsRepository.replaceSecurityPolicyIf(
        workspaceId,
        raw,
        next
      )
    ) {
      await recordAuditEvent({
        workspaceId,
        action: 'workspace.agent_review_blocking_updated',
        target: { type: 'workspace', id: workspaceId },
        metadata: {
          from: agentReviewBlocking(parseSecurityPolicy(raw)),
          to: level,
          changes: { securityPolicy: { from: raw, to: next } },
        },
        context: audit,
      })
      return
    }
  }
  throw Object.assign(
    new Error('The security policy changed while saving — try again'),
    { status: 409 }
  )
}

export const securityScanSettingsService = {
  async get(caller: SecurityScanSettingsCaller): Promise<SecurityScanSettings> {
    const [stored, role, policy] = await Promise.all([
      securityColumnsRepository.findSecuritySwitches(caller.workspaceId),
      miscRepository.findMemberRoleById(caller.memberId),
      securityColumnsRepository.findSecurityPolicy(caller.workspaceId),
    ])
    if (!stored) {
      throw Object.assign(new Error('Workspace not found'), { status: 404 })
    }
    const switches = { ...DEFAULT_WORKSPACE_SECURITY_SWITCHES, ...stored }
    return {
      switches,
      platform: platformSecurityCeiling(process.env, caller.workspaceId),
      effective: resolveSecurityLayers(
        switches,
        process.env,
        caller.workspaceId
      ),
      canEdit: role === 'OWNER',
      agentReviewBlocking: agentReviewBlocking(parseSecurityPolicy(policy)),
    }
  },

  /**
   * OWNER only (enforced by `updateWorkspace`); returns the new settings.
   * The role comes from the caller's member row, so a CLI bearer (whose
   * identity carries no role) meets the same gate as the browser.
   */
  async update(
    caller: SecurityScanSettingsCaller & { workspaceSlug: string },
    update: SecurityScanSettingsUpdate,
    audit?: AuditContext
  ): Promise<SecurityScanSettings> {
    const [role, before] = await Promise.all([
      miscRepository.findMemberRoleById(caller.memberId),
      securityColumnsRepository.findSecuritySwitches(caller.workspaceId),
    ])
    // LUM-1329: the policy's AGENT_REVIEW entries, as a compare-and-set of
    // their own, go first — a 409 (the policy kept changing) then leaves the
    // switches unsaved too. It needs the OWNER gate updateWorkspace applies.
    if (update.agentReviewBlocking !== undefined) {
      if (role !== 'OWNER')
        throw Object.assign(
          new Error('Only admins can update workspace settings'),
          { status: 403 }
        )
      await writeAgentReviewBlocking(
        caller.workspaceId,
        update.agentReviewBlocking,
        audit
      )
    }
    await workspaceService.updateWorkspace(
      caller.workspaceId,
      role ?? '',
      caller.workspaceSlug,
      switchesForUpdate(update),
      audit
    )
    const settings = await this.get(caller)
    // LUM-1140: the request-changes workflow went on → off — dismiss Lumo's
    // standing "changes requested" reviews on the workspace's open PRs, in
    // the background (bounded; a PR it misses is caught at its next review).
    if (
      before?.securityRequestChangesEnabled === true &&
      !settings.switches.securityRequestChangesEnabled
    ) {
      waitUntil(withdrawChangeRequests(caller.workspaceId))
    }
    return settings
  },
}
