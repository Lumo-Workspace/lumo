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

function err(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status })
}

function mapSlackError(e: unknown): Error & { status: number } {
  if (e instanceof SlackApiError) {
    switch (e.code) {
      case 'not_in_channel':
        return err('not_in_channel', 403)
      case 'channel_not_found':
      case 'message_not_found':
        return err('message_gone', 404)
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

    return taskSlackContextRepository.create({
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
    })
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
    return taskSlackContextRepository.updateSnapshot(contextId, snapshot, null)
  },

  async unlinkContext(contextId: string, expectedWorkspaceId: string) {
    const ctx = await taskSlackContextRepository.getById(contextId)
    if (!ctx || ctx.workspaceId !== expectedWorkspaceId)
      throw err('not_found', 404)
    await taskSlackContextRepository.delete(contextId)
  },
}
