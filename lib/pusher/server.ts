import Pusher from 'pusher'

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

// ── Agent events (existing) ─────────────────────────────────────────────────

export type AgentEvent =
  | { type: 'agent:started' }
  | { type: 'agent:thinking'; message: string }
  | { type: 'agent:tool'; tool: string; input: string }
  | { type: 'agent:progress'; message: string }
  | { type: 'agent:clarify'; question: string; context: string | null }
  | { type: 'agent:spec_draft'; spec: string }
  | { type: 'agent:done'; prUrl: string; prNumber: number }
  | { type: 'agent:failed'; error: string }

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

// ── Task events (comments, field changes) ───────────────────────────────────

export type TaskEvent =
  | { type: 'comment:created'; commentId: string }
  | { type: 'comment:updated'; commentId: string }
  | { type: 'comment:deleted'; commentId: string }
  | { type: 'task:updated'; fields: string[] }

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

// ── User events (notifications) ─────────────────────────────────────────────

export type UserEvent = { type: 'notification:new' }

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
