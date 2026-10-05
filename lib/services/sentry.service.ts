import { encrypt, decrypt } from '@/lib/crypto'
import { logger } from '@/lib/logger'
import { DEFAULT_BUG_TAG_COLOR } from '@/lib/constants/colors'
import { sentryRepository } from '@/lib/repositories/sentry.repository'
import { tagRepository } from '@/lib/repositories/tag.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import {
  verifySentrySignature,
  extractIssueFields,
  mapLevelToPriority,
  pickSuggestedOwnerEmails,
  buildTaskDescription,
  type SentryIssueAlertPayload,
} from '@/lib/integrations/sentry'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { taskService } from '@/lib/services/task.service'
import { taskRepository } from '@/lib/repositories/task.repository'
import {
  recordAuditEvent,
  type AuditContext,
} from '@/lib/services/audit.service'

/**
 * The Sentry webhook payload does not carry the org slug as a dedicated field.
 * It is the first label of the host component of `data.event.web_url`, e.g.
 * "acme-inc.sentry.io" → "acme-inc".
 */
function extractOrgSlugFromWebUrl(webUrl: string | undefined): string | null {
  if (!webUrl) return null
  try {
    const host = new URL(webUrl).host
    const first = host.split('.')[0]
    return first && first !== 'sentry' ? first : null
  } catch {
    return null
  }
}

export const sentryService = {
  async getIntegrationStatus(workspaceId: string) {
    const integration =
      await sentryRepository.findIntegrationByWorkspace(workspaceId)
    if (!integration) return { connected: false } as const
    return {
      connected: true,
      orgSlug: integration.orgSlug,
      lastWebhookAt: integration.lastWebhookAt,
      installedBy: integration.installedBy,
    } as const
  },

  async connectIntegration(
    workspaceId: string,
    memberId: string,
    role: string,
    data: { orgSlug: string; clientSecret: string },
    audit?: AuditContext
  ) {
    if (role !== 'OWNER') {
      throw Object.assign(
        new Error('Only workspace owners can connect Sentry'),
        { status: 403 }
      )
    }
    const row = await sentryRepository.upsertIntegration({
      workspaceId,
      installedBy: memberId,
      orgSlug: data.orgSlug,
      clientSecret: encrypt(data.clientSecret),
    })
    await recordAuditEvent({
      workspaceId,
      action: 'sentry.connected',
      target: { type: 'integration', id: 'sentry' },
      metadata: { orgSlug: data.orgSlug },
      context: audit,
    })
    return row
  },

  async disconnectIntegration(
    workspaceId: string,
    role: string,
    audit?: AuditContext
  ) {
    if (role !== 'OWNER') {
      throw Object.assign(
        new Error('Only workspace owners can disconnect Sentry'),
        { status: 403 }
      )
    }
    const deleted = await sentryRepository.deleteIntegration(workspaceId)
    await recordAuditEvent({
      workspaceId,
      action: 'sentry.disconnected',
      target: { type: 'integration', id: 'sentry' },
      context: audit,
    })
    return deleted
  },

  async listMappings(workspaceId: string) {
    const integration =
      await sentryRepository.findIntegrationByWorkspace(workspaceId)
    if (!integration) {
      throw Object.assign(new Error('Sentry not connected'), { status: 404 })
    }
    return sentryRepository.listMappings(integration.id)
  },

  async createMapping(
    workspaceId: string,
    role: string,
    data: { sentryProjectSlug: string; projectId: string },
    audit?: AuditContext
  ) {
    if (role !== 'OWNER') {
      throw Object.assign(
        new Error('Only workspace owners can manage Sentry mappings'),
        { status: 403 }
      )
    }
    const integration =
      await sentryRepository.findIntegrationByWorkspace(workspaceId)
    if (!integration) {
      throw Object.assign(new Error('Sentry not connected'), { status: 404 })
    }
    const project = await sentryRepository.findProjectInWorkspace(
      data.projectId,
      workspaceId
    )
    if (!project) {
      throw Object.assign(new Error('Project is not part of this workspace'), {
        status: 400,
      })
    }
    const existing = await sentryRepository.findMappingByProjectSlug(
      integration.id,
      data.sentryProjectSlug
    )
    if (existing) {
      throw Object.assign(new Error('This Sentry project is already mapped'), {
        status: 409,
      })
    }
    const created = await sentryRepository.createMapping({
      integrationId: integration.id,
      sentryProjectSlug: data.sentryProjectSlug,
      projectId: data.projectId,
    })
    await recordAuditEvent({
      workspaceId,
      action: 'sentry.mapping_created',
      target: { type: 'sentry_mapping', id: created.id },
      metadata: {
        sentryProjectSlug: data.sentryProjectSlug,
        projectId: data.projectId,
      },
      context: audit,
    })
    return created
  },

  async deleteMapping(
    workspaceId: string,
    role: string,
    mappingId: string,
    audit?: AuditContext
  ) {
    if (role !== 'OWNER') {
      throw Object.assign(
        new Error('Only workspace owners can manage Sentry mappings'),
        { status: 403 }
      )
    }
    const mapping = await sentryRepository.findMappingWithIntegration(mappingId)
    if (!mapping || mapping.integration.workspaceId !== workspaceId) {
      throw Object.assign(new Error('Not found'), { status: 404 })
    }
    const deleted = await sentryRepository.deleteMapping(mappingId)
    await recordAuditEvent({
      workspaceId,
      action: 'sentry.mapping_deleted',
      target: { type: 'sentry_mapping', id: mappingId },
      context: audit,
    })
    return deleted
  },

  async _ensureBugTag(workspaceId: string): Promise<string> {
    const existing = await tagRepository.findByName(workspaceId, 'bug')
    if (existing) return existing.id
    try {
      const created = await tagRepository.create({
        workspaceId,
        name: 'bug',
        color: DEFAULT_BUG_TAG_COLOR,
      })
      return created.id
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        const raced = await tagRepository.findByName(workspaceId, 'bug')
        if (raced) return raced.id
      }
      throw err
    }
  },

  async _resolveAssignee(
    workspaceId: string,
    emails: string[]
  ): Promise<string | null> {
    if (emails.length === 0) return null
    const actorIds = await memberRepository.findActorsByEmailInWorkspace(
      workspaceId,
      emails
    )
    return actorIds[0] ?? null
  },

  /**
   * Handle an incoming Sentry issue-alert webhook.
   *
   * Flow:
   *   1. Parse JSON + extract orgSlug from data.event.web_url.
   *   2. Look up integration, decrypt its secret, verify HMAC signature.
   *   3. Extract issue fields. On missing required ids, log + skip.
   *   4. Look up Sentry project → Lumo project mapping. If absent, skip.
   *   5. Dedup: if an SentryIssueLink already exists, record a repeated-alert
   *      activity (and reopen the task if it is DONE).
   *   6. Otherwise create a task + link. P2002 on link is treated as a race
   *      with a concurrent webhook and falls through to the repeated flow.
   */
  async handleWebhook(input: {
    rawBody: string
    signature: string | null
  }): Promise<
    | { created: true; taskId: string }
    | { repeated: true; taskId: string }
    | { skipped: 'no_mapping' | 'missing_issue_id' }
  > {
    if (!input.signature) {
      throw Object.assign(new Error('Missing signature'), { status: 401 })
    }

    let payload: SentryIssueAlertPayload
    try {
      payload = JSON.parse(input.rawBody) as SentryIssueAlertPayload
    } catch {
      throw Object.assign(new Error('Invalid JSON'), { status: 400 })
    }

    const orgSlug = extractOrgSlugFromWebUrl(payload.data?.event?.web_url)
    if (!orgSlug) {
      throw Object.assign(new Error('Cannot determine org slug'), {
        status: 400,
      })
    }

    const integration = await sentryRepository.findIntegrationByOrgSlug(orgSlug)
    if (!integration) {
      throw Object.assign(new Error('Unknown org'), { status: 404 })
    }

    const secret = decrypt(integration.clientSecret)
    if (!verifySentrySignature(input.rawBody, input.signature, secret)) {
      throw Object.assign(new Error('Invalid signature'), { status: 401 })
    }

    let fields: ReturnType<typeof extractIssueFields>
    try {
      fields = extractIssueFields(payload)
    } catch (err) {
      logger.error('[sentry/webhook] payload parse error:', err)
      return { skipped: 'missing_issue_id' }
    }

    const mapping = await sentryRepository.findMappingByProjectSlug(
      integration.id,
      fields.sentryProjectSlug
    )
    if (!mapping) {
      await sentryRepository.markWebhookReceived(integration.id).catch(() => {})
      return { skipped: 'no_mapping' }
    }

    // Dedup check.
    const existing = await sentryRepository.findLink(
      integration.id,
      fields.sentryIssueId
    )
    if (existing) {
      await this._handleRepeatedAlert(existing.taskId, fields)
      await sentryRepository.markWebhookReceived(integration.id).catch(() => {})
      return { repeated: true, taskId: existing.taskId }
    }

    // First time: create task + link.
    try {
      const taskId = await this._createTaskFromIssue(
        integration.workspaceId,
        mapping.projectId,
        fields,
        payload
      )
      await sentryRepository.createLink({
        integrationId: integration.id,
        sentryIssueId: fields.sentryIssueId,
        taskId,
      })
      await sentryRepository.markWebhookReceived(integration.id).catch(() => {})
      return { created: true, taskId }
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        // Concurrent webhook beat us. Re-read and treat as repeated.
        const now = await sentryRepository.findLink(
          integration.id,
          fields.sentryIssueId
        )
        if (now) {
          await this._handleRepeatedAlert(now.taskId, fields)
          await sentryRepository
            .markWebhookReceived(integration.id)
            .catch(() => {})
          return { repeated: true, taskId: now.taskId }
        }
      }
      throw err
    }
  },

  async _createTaskFromIssue(
    workspaceId: string,
    projectId: string,
    fields: ReturnType<typeof extractIssueFields>,
    payload: SentryIssueAlertPayload
  ): Promise<string> {
    const bugTagId = await this._ensureBugTag(workspaceId)
    const assigneeActorId = await this._resolveAssignee(
      workspaceId,
      pickSuggestedOwnerEmails(payload)
    )

    const { task } = await taskService.createFromAutomation(projectId, {
      title: fields.title,
      description: buildTaskDescription(fields),
      priority: mapLevelToPriority(fields.level),
      assigneeActorId,
      tagIds: [bugTagId],
    })

    return task.id
  },

  async _handleRepeatedAlert(
    taskId: string,
    fields: ReturnType<typeof extractIssueFields>
  ): Promise<void> {
    const task = await taskRepository.findById(taskId)
    if (!task) return

    await activityRepository.create({
      taskId,
      type: 'SENTRY_ALERT',
      actorId: null,
      payload: {
        triggeredRule: fields.triggeredRule,
        eventCount: fields.eventCount,
        lastSeen: fields.lastSeen,
        webUrl: fields.webUrl,
        level: fields.level,
      },
    })

    if (task.status === 'DONE') {
      await taskService.reopen(taskId, {
        reason: 'sentry_regression',
        actorId: null,
      })
    }
  },
}
