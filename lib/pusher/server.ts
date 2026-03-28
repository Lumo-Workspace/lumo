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
    // Non-fatal — don't let Pusher errors kill the agent
    console.error('[pusher] Failed to push event:', err)
  }
}
