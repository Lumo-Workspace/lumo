/**
 * Agent communication tools — ask_user & report_progress.
 *
 * These use the same HTTP API endpoints as the sandbox MCP server,
 * enabling local Claude Code to participate in the same clarify flow
 * as the hosted agent.
 *
 * Requires env vars:
 *   MCP_TASK_ID       — current task ID (set per invocation)
 *   MCP_LUMO_API_URL  — Lumo backend URL (default: http://localhost:3000)
 *   MCP_API_TOKEN     — optional bearer token for auth
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

const POLL_INTERVAL_MS = 5000
const POLL_TIMEOUT_MS = 25 * 60 * 1000 // 25 min
const MAX_RETRIES = 3

// ── Env helpers ───────────────────────────────────────────────────────────

function getApiUrl(): string {
  return process.env.MCP_LUMO_API_URL || 'http://localhost:3000'
}

function getTaskId(): string {
  const id = process.env.MCP_TASK_ID
  if (!id)
    throw new Error(
      'MCP_TASK_ID is not set — cannot use agent communication tools'
    )
  return id
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = process.env.MCP_API_TOKEN
  if (token) h['Authorization'] = `Bearer ${token}`
  return h
}

// ── HTTP helpers ──────────────────────────────────────────────────────────

async function httpPost(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${getApiUrl()}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`)
  return res.json()
}

async function httpGet(path: string): Promise<any> {
  const res = await fetch(`${getApiUrl()}${path}`, {
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`)
  return res.json()
}

async function httpWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: Error | undefined
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e as Error
      if (i < MAX_RETRIES - 1) {
        await new Promise(r => setTimeout(r, 2000 * (i + 1)))
      }
    }
  }
  throw lastErr
}

// ── Poll for reply ────────────────────────────────────────────────────────

async function pollForReply(clarifyId: string): Promise<string> {
  const start = Date.now()
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    try {
      const data = await httpGet(`/api/agent/mcp-clarify/${clarifyId}`)
      if (data.status === 'replied' && data.reply) {
        return data.reply
      }
    } catch {
      // Network error — will retry on next interval
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
  }
  throw new Error('Timed out waiting for user reply (25 min)')
}

// ── Tool registration ─────────────────────────────────────────────────────

export function registerAgentCommTools(server: McpServer) {
  server.tool(
    'ask_user',
    'Ask the user a clarifying question and wait for their reply. ' +
      'Use when the spec is ambiguous or missing critical details. ' +
      'Blocks until the user responds (up to 25 minutes).',
    {
      question: z.string().describe('The question to ask the user'),
      context: z
        .string()
        .optional()
        .describe('What you were doing when you got stuck'),
    },
    async ({ question, context }) => {
      const taskId = getTaskId()

      // Submit question to Lumo backend
      const result = await httpWithRetry(() =>
        httpPost('/api/agent/mcp-clarify', {
          taskId,
          question,
          context: context ?? null,
        })
      )

      const clarifyId = result.clarifyId
      if (!clarifyId) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Error: backend did not return clarifyId',
            },
          ],
          isError: true,
        }
      }

      // Poll until user replies
      const reply = await pollForReply(clarifyId)
      return { content: [{ type: 'text' as const, text: reply }] }
    }
  )

  server.tool(
    'report_progress',
    'Report a progress message to the user. Use sparingly for major milestones only.',
    {
      message: z.string().describe('A short progress update'),
    },
    async ({ message }) => {
      try {
        await httpPost('/api/agent/mcp-progress', {
          taskId: getTaskId(),
          message,
        })
      } catch {
        // Non-critical — don't fail the tool
      }
      return {
        content: [{ type: 'text' as const, text: 'Progress reported.' }],
      }
    }
  )
}
