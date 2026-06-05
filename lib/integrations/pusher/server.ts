import Pusher from 'pusher'
import type {
  AgentEvent,
  DocumentEvent,
  TaskEvent,
  ProjectEvent,
  UserEvent,
  WorkspaceEvent,
} from './types'

let _pusher: Pusher | null = null

function getPusher(): Pusher {
  if (!_pusher) {
    _pusher = new Pusher({
      appId: process.env.PUSHER_APP_ID!,
      key: process.env.PUSHER_KEY!,
      secret: process.env.PUSHER_SECRET!,
      cluster: process.env.PUSHER_CLUSTER!,
      useTLS: true,
    })
  }
  return _pusher
}

export async function pushAgentEvent(
  taskId: string,
  event: AgentEvent
): Promise<void> {
  try {
    await getPusher().trigger(`task-${taskId}`, 'agent-update', event)
  } catch (err) {
    console.error('[pusher] Failed to push agent event:', err)
  }
}

/** Fire-and-forget version — use for non-critical progress/thinking events. */
export function fireAgentEvent(taskId: string, event: AgentEvent): void {
  void pushAgentEvent(taskId, event)
}

export async function pushTaskEvent(
  taskId: string,
  event: TaskEvent
): Promise<void> {
  try {
    await getPusher().trigger(`task-${taskId}`, 'task-update', event)
  } catch (err) {
    console.error('[pusher] Failed to push task event:', err)
  }
}

export async function pushProjectEvent(
  projectId: string,
  event: ProjectEvent
): Promise<void> {
  try {
    await getPusher().trigger(`project-${projectId}`, 'project-update', event)
  } catch (err) {
    console.error('[pusher] Failed to push project event:', err)
  }
}

export async function pushUserEvent(
  clerkId: string,
  event: UserEvent
): Promise<void> {
  try {
    await getPusher().trigger(`user-${clerkId}`, 'user-update', event)
  } catch (err) {
    console.error('[pusher] Failed to push user event:', err)
  }
}

export async function pushActivityEvent(
  taskId: string,
  entry: Record<string, unknown>
): Promise<void> {
  try {
    await getPusher().trigger(`task-${taskId}`, 'activity-created', {
      type: 'activity:created',
      entry,
    })
  } catch (err) {
    console.error('[pusher] Failed to push activity event:', err)
  }
}

export async function pushWorkspaceEvent(
  workspaceSlug: string,
  event: WorkspaceEvent
): Promise<void> {
  try {
    await getPusher().trigger(
      `workspace-${workspaceSlug}`,
      'workspace-update',
      event
    )
  } catch (err) {
    console.error('[pusher] Failed to push workspace event:', err)
  }
}

export async function pushDocumentEvent(
  documentId: string,
  event: DocumentEvent
): Promise<void> {
  try {
    await getPusher().trigger(
      `document-${documentId}`,
      'document-update',
      event
    )
  } catch (err) {
    console.error('[pusher] Failed to push document event:', err)
  }
}
