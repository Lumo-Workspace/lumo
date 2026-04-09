/**
 * Proxy helper for forwarding agent requests to the agent-server service.
 *
 * When AGENT_SERVICE_URL is set, routes delegate to the external agent-server.
 * When not set, they fall back to the local executeAgent() for backward compat.
 */

const AGENT_SERVICE_URL = process.env.AGENT_SERVICE_URL
const AGENT_SERVICE_SECRET = process.env.AGENT_SERVICE_SECRET

export function isAgentServiceEnabled(): boolean {
  return !!AGENT_SERVICE_URL
}

/**
 * Forward a request body to the agent-server and return the JSON response.
 */
export async function proxyToAgentService(
  path: string,
  body: unknown
): Promise<{ status: number; data: unknown }> {
  if (!AGENT_SERVICE_URL || !AGENT_SERVICE_SECRET) {
    throw new Error('AGENT_SERVICE_URL and AGENT_SERVICE_SECRET are required')
  }

  const res = await fetch(`${AGENT_SERVICE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${AGENT_SERVICE_SECRET}`,
    },
    body: JSON.stringify(body),
  })

  const data = await res.json().catch(() => ({ error: 'Invalid response' }))
  return { status: res.status, data }
}
