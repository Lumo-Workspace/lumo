import Pusher from 'pusher'
import type {
  AgentEvent,
  DocumentEvent,
  TaskEvent,
  ProjectEvent,
  UserEvent,
  WorkspaceEvent,
} from './types'
import { logger } from '@/lib/logger'
import {
  readServerPusherEnv,
  resolveServerPusherConfig,
  type PusherServerConfig,
} from './config'

// `undefined` = not resolved yet; `null` = realtime not configured (no-op).
let _pusher: Pusher | null | undefined

function toPusherOptions(config: PusherServerConfig): Pusher.Options {
  const { appId, key, secret, useTLS } = config
  if (config.mode === 'custom') {
    return {
      appId,
      key,
      secret,
      host: config.host,
      ...(config.port ? { port: config.port } : {}),
      useTLS,
    }
  }
  return { appId, key, secret, cluster: config.cluster, useTLS }
}

function getPusher(): Pusher | null {
  if (_pusher !== undefined) return _pusher
  const config = resolveServerPusherConfig(readServerPusherEnv())
  if (!config) {
    // Logged once per process: self-hosted installs without a Pusher-protocol
    // server are a supported setup, not an error.
    logger.info(
      '[pusher] Realtime not configured (PUSHER_APP_ID/KEY/SECRET + CLUSTER or HOST); events will not be pushed.'
    )
    _pusher = null
    return _pusher
  }
  _pusher = new Pusher(toPusherOptions(config))
  return _pusher
}

/** True when server-side triggers will actually reach a Pusher-protocol server. */
export function isServerRealtimeConfigured(): boolean {
  return getPusher() !== null
}

/**
 * LUM-1332 — one signed request to the Pusher-protocol server (`GET
 * /channels`), for the self-host config check: proves the server is
 * reachable from the app and accepts these credentials. Never throws.
 */
export async function checkRealtimeConnection(): Promise<
  | { status: 'ok' }
  | { status: 'not_configured' }
  | { status: 'failed'; message: string }
> {
  try {
    const pusher = getPusher()
    if (!pusher) return { status: 'not_configured' }
    const res = await pusher.get({ path: '/channels' })
    if (res.status === 200) return { status: 'ok' }
    return { status: 'failed', message: `HTTP ${res.status}` }
  } catch (err) {
    const status = (err as { status?: unknown }).status
    const message =
      typeof status === 'number'
        ? `HTTP ${status}`
        : err instanceof Error
          ? err.message
          : String(err)
    return { status: 'failed', message: message.slice(0, 200) }
  }
}

async function trigger(
  channel: string,
  eventName: string,
  data: unknown,
  label: string
): Promise<void> {
  try {
    // Inside the try: a bad config that makes the constructor throw must not
    // break the caller either.
    const pusher = getPusher()
    if (!pusher) return
    await pusher.trigger(channel, eventName, data)
  } catch (err) {
    logger.error(`[pusher] Failed to push ${label} event:`, err)
  }
}

export async function pushAgentEvent(
  taskId: string,
  event: AgentEvent
): Promise<void> {
  await trigger(`task-${taskId}`, 'agent-update', event, 'agent')
}

/** Fire-and-forget version — use for non-critical progress/thinking events. */
export function fireAgentEvent(taskId: string, event: AgentEvent): void {
  void pushAgentEvent(taskId, event)
}

export async function pushTaskEvent(
  taskId: string,
  event: TaskEvent
): Promise<void> {
  await trigger(`task-${taskId}`, 'task-update', event, 'task')
}

export async function pushProjectEvent(
  projectId: string,
  event: ProjectEvent
): Promise<void> {
  await trigger(`project-${projectId}`, 'project-update', event, 'project')
}

export async function pushUserEvent(
  clerkId: string,
  event: UserEvent
): Promise<void> {
  await trigger(`user-${clerkId}`, 'user-update', event, 'user')
}

export async function pushActivityEvent(
  taskId: string,
  entry: Record<string, unknown>
): Promise<void> {
  await trigger(
    `task-${taskId}`,
    'activity-created',
    { type: 'activity:created', entry },
    'activity'
  )
}

export async function pushWorkspaceEvent(
  workspaceSlug: string,
  event: WorkspaceEvent
): Promise<void> {
  await trigger(
    `workspace-${workspaceSlug}`,
    'workspace-update',
    event,
    'workspace'
  )
}

export async function pushDocumentEvent(
  documentId: string,
  event: DocumentEvent
): Promise<void> {
  await trigger(`document-${documentId}`, 'document-update', event, 'document')
}
