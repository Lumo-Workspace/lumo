import type {
  SlackContextSnapshot,
  SlackContextMessage,
} from '@/types/slack-context'

export class SlackApiError extends Error {
  constructor(
    public readonly code: string,
    message?: string
  ) {
    super(message ?? code)
    this.name = 'SlackApiError'
  }
}

export interface RawSlackMessage {
  ts: string
  user: string
  text: string
  edited?: unknown
  files?: Array<{ name: string; permalink: string; mimetype: string }>
}

async function slackPost(
  token: string,
  method: string,
  body: object
): Promise<{ [k: string]: unknown }> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new SlackApiError('slack_unavailable', `HTTP ${res.status}`)
  }
  const json = (await res.json()) as { ok: boolean; error?: string }
  if (!json.ok) {
    throw new SlackApiError(json.error ?? 'slack_unknown_error')
  }
  return json as { [k: string]: unknown }
}

export async function fetchSingleMessage(
  token: string,
  channelId: string,
  ts: string
): Promise<RawSlackMessage> {
  const json = await slackPost(token, 'conversations.history', {
    channel: channelId,
    latest: ts,
    inclusive: true,
    limit: 1,
  })
  const messages = (json.messages as RawSlackMessage[] | undefined) ?? []
  const msg = messages[0]
  if (!msg || msg.ts !== ts) {
    throw new SlackApiError('message_not_found')
  }
  return msg
}

export async function fetchThread(
  token: string,
  channelId: string,
  threadTs: string
): Promise<RawSlackMessage[]> {
  const all: RawSlackMessage[] = []
  let cursor: string | undefined
  while (true) {
    const json = await slackPost(token, 'conversations.replies', {
      channel: channelId,
      ts: threadTs,
      ...(cursor ? { cursor } : {}),
    })
    const batch = (json.messages as RawSlackMessage[] | undefined) ?? []
    all.push(...batch)
    const meta = json.response_metadata as { next_cursor?: string } | undefined
    if (json.has_more && meta?.next_cursor) {
      cursor = meta.next_cursor
    } else {
      break
    }
  }
  if (all.length === 0) throw new SlackApiError('message_not_found')
  return all
}

export async function resolveUsers(
  token: string,
  userIds: string[]
): Promise<Map<string, { name: string | null; avatarUrl: string | null }>> {
  const unique = Array.from(new Set(userIds))
  const out = new Map<
    string,
    { name: string | null; avatarUrl: string | null }
  >()
  await Promise.all(
    unique.map(async id => {
      try {
        const json = await slackPost(token, 'users.info', { user: id })
        const user = json.user as
          | {
              profile?: {
                display_name?: string
                real_name?: string
                image_72?: string
              }
            }
          | undefined
        const profile = user?.profile
        out.set(id, {
          name:
            profile?.display_name?.trim() || profile?.real_name?.trim() || null,
          avatarUrl: profile?.image_72 ?? null,
        })
      } catch {
        out.set(id, { name: null, avatarUrl: null })
      }
    })
  )
  return out
}

export async function resolveChannelName(
  token: string,
  channelId: string
): Promise<string | null> {
  try {
    const json = await slackPost(token, 'conversations.info', {
      channel: channelId,
    })
    const channel = json.channel as { name?: string } | undefined
    return channel?.name ?? null
  } catch {
    return null
  }
}

export function toSnapshot(
  rawMessages: RawSlackMessage[],
  users: Map<string, { name: string | null; avatarUrl: string | null }>
): SlackContextSnapshot {
  const messages: SlackContextMessage[] = rawMessages.map(m => {
    const u = users.get(m.user) ?? { name: null, avatarUrl: null }
    const out: SlackContextMessage = {
      ts: m.ts,
      userId: m.user,
      userName: u.name,
      userAvatarUrl: u.avatarUrl,
      text: m.text ?? '',
      edited: m.edited != null,
    }
    if (m.files && m.files.length > 0) {
      out.files = m.files.map(f => ({
        name: f.name,
        permalink: f.permalink,
        mimeType: f.mimetype,
      }))
    }
    return out
  })
  return { messages }
}
