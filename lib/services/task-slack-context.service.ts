import { parseSlackPermalink } from '@/lib/integrations/slack/parse-permalink'
import { getSlackIntegrationToken } from '@/lib/integrations/slack/token'
import {
  fetchSingleMessage,
  fetchThread,
  resolveUsers,
  resolveChannelName,
  toSnapshot,
  SlackApiError,
} from '@/lib/integrations/slack/context-fetcher'
import { taskSlackContextRepository } from '@/lib/repositories/task-slack-context.repository'
import { waitUntil } from '@/lib/runtime/wait-until'
import { contentSummaryService } from '@/lib/services/content-summary.service'
import { scanSlackSnapshot } from '@/lib/services/content-signals'

function err(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status })
}

/** Flatten a thread snapshot into "name: text" lines for summarization. */
export function buildSlackSummaryInput(snapshot: {
  messages: Array<{ userId: string; userName: string | null; text: string }>
}): string {
  return snapshot.messages
    .map(m => `${m.userName ?? m.userId}: ${m.text}`)
    .join('\n')
}

/**
 * Fire-and-forget: generate a thread summary and cache it on the row.
 * Runs via waitUntil so it never blocks the API response, and swallows
 * errors so a summarization failure never surfaces to the caller.
 */
function scheduleSlackSummary(
  contextId: string,
  snapshot: {
    messages: Array<{ userId: string; userName: string | null; text: string }>
  }
): void {
  waitUntil(
    contentSummaryService
      .summarize(buildSlackSummaryInput(snapshot), 'slack')
      .then(s =>
        s ? taskSlackContextRepository.updateSummary(contextId, s) : undefined
      )
      .catch(() => {})
  )
}

function mapSlackError(e: unknown): Error & { status: number } {
  if (e instanceof SlackApiError) {
    switch (e.code) {
      case 'not_in_channel':
        return err('not_in_channel', 403)
      case 'channel_not_found':
      case 'message_not_found':
        return err('message_gone', 404)
      case 'missing_scope':
        // Bot installed with an older scope set; admin needs to reinstall.
        return err('missing_scope', 403)
      case 'slack_unavailable':
        return err('slack_unavailable', 502)
      default:
        return err(`slack_error:${e.code}`, 502)
    }
  }
  return err('internal_error', 500)
}

export interface LinkSlackPermalinkInput {
  taskId: string
  workspaceId: string
  permalink: string
  actorMemberId: string
}

export const taskSlackContextService = {
  async listForTask(taskId: string) {
    return taskSlackContextRepository.listByTask(taskId)
  },

  async linkSlackPermalink(input: LinkSlackPermalinkInput) {
    const parsed = parseSlackPermalink(input.permalink)
    if (!parsed) throw err('invalid_permalink', 400)

    const integration = await getSlackIntegrationToken(input.workspaceId)
    if (!integration) throw err('not_connected', 412)

    let raw
    try {
      raw = parsed.threadTs
        ? await fetchThread(
            integration.token,
            parsed.channelId,
            parsed.threadTs
          )
        : [
            await fetchSingleMessage(
              integration.token,
              parsed.channelId,
              parsed.ts
            ),
          ]
    } catch (e) {
      throw mapSlackError(e)
    }

    const channelName = await resolveChannelName(
      integration.token,
      parsed.channelId
    )
    const users = await resolveUsers(
      integration.token,
      raw.map(m => m.user)
    )
    const snapshot = toSnapshot(raw, users)

    const created = await taskSlackContextRepository.create({
      taskId: input.taskId,
      workspaceId: input.workspaceId,
      permalink: input.permalink,
      slackTeamId: integration.slackTeamId,
      slackChannelId: parsed.channelId,
      slackChannelName: channelName,
      rootTs: parsed.threadTs ?? parsed.ts,
      threadTs: parsed.threadTs ?? null,
      isThread: parsed.threadTs != null,
      snapshot,
      snapshotAt: new Date(),
      createdById: input.actorMemberId,
      // LUM-783: record injection-shaped content on the source card.
      contentSignals: scanSlackSnapshot(snapshot),
    })

    scheduleSlackSummary(created.id, snapshot)
    return created
  },

  async refreshContext(contextId: string, expectedWorkspaceId: string) {
    const ctx = await taskSlackContextRepository.getById(contextId)
    if (!ctx || ctx.workspaceId !== expectedWorkspaceId)
      throw err('not_found', 404)

    const integration = await getSlackIntegrationToken(ctx.workspaceId)
    if (!integration) throw err('not_connected', 412)

    let raw
    try {
      raw = ctx.isThread
        ? await fetchThread(integration.token, ctx.slackChannelId, ctx.rootTs)
        : [
            await fetchSingleMessage(
              integration.token,
              ctx.slackChannelId,
              ctx.rootTs
            ),
          ]
    } catch (e) {
      const mapped = mapSlackError(e)
      await taskSlackContextRepository.updateSnapshot(
        contextId,
        null,
        mapped.message
      )
      throw mapped
    }

    const users = await resolveUsers(
      integration.token,
      raw.map(m => m.user)
    )
    const snapshot = toSnapshot(raw, users)
    const updated = await taskSlackContextRepository.updateSnapshot(
      contextId,
      snapshot,
      null,
      scanSlackSnapshot(snapshot)
    )

    scheduleSlackSummary(contextId, snapshot)
    return updated
  },

  async unlinkContext(contextId: string, expectedWorkspaceId: string) {
    const ctx = await taskSlackContextRepository.getById(contextId)
    if (!ctx || ctx.workspaceId !== expectedWorkspaceId)
      throw err('not_found', 404)
    await taskSlackContextRepository.delete(contextId)
  },
}
