/**
 * Generates the MCP server code and config to inject into the E2B sandbox.
 *
 * The MCP server runs as a pure-Node.js process (no npm dependencies) and
 * implements the JSON-RPC 2.0 subset required by the MCP protocol over stdio.
 *
 * It provides two tools to the Claude Code agent:
 *
 *   ask_user(question, context?)
 *     — Writes the question to /tmp/clarify-question.txt, then polls
 *       /tmp/clarify-reply.txt every 5 s until a reply appears.
 *       Returns the reply text so the agent can continue without exiting.
 *
 *   report_progress(message)
 *     — Fire-and-forget POST to the Lumo callback URL so the backend can
 *       push real-time progress to the frontend via Pusher (optional, only
 *       if CALLBACK_URL is set).
 */

import type { Sandbox } from '@e2b/code-interpreter'

// ── MCP server source (injected as a single .mjs file) ────────────────────

const MCP_SERVER_SOURCE = `#!/usr/bin/env node
// Lumo Sandbox MCP Server — zero dependencies, JSON-RPC 2.0 over stdio
// Provides: ask_user, report_progress

import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { createInterface } from 'node:readline'

const REPLY_FILE    = '/tmp/clarify-reply.txt'
const QUESTION_FILE = '/tmp/clarify-question.txt'
const POLL_INTERVAL = 5000       // ms between reply checks
const POLL_TIMEOUT  = 25 * 60000 // max wait for user reply (25 min)
const CALLBACK_URL  = process.env.LUMO_CALLBACK_URL || ''
const CALLBACK_TOKEN = process.env.LUMO_CALLBACK_TOKEN || ''
const TASK_ID       = process.env.LUMO_TASK_ID || ''

// ── JSON-RPC helpers ───────────────────────────────────────────────────────

function send(obj) {
  const body = JSON.stringify(obj)
  process.stdout.write('Content-Length: ' + Buffer.byteLength(body) + '\\r\\n\\r\\n' + body)
}

function ok(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

function err(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

// ── Tool definitions ──────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'ask_user',
    description:
      'Ask the user a clarifying question and wait for their reply. ' +
      'Use this when the spec is ambiguous, missing critical details, or you are unsure how to proceed. ' +
      'The tool will BLOCK until the user responds (up to 25 minutes). ' +
      'Do NOT stop or exit after calling this — the reply will be returned to you.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question to ask the user' },
        context:  { type: 'string', description: 'What you were doing when you got stuck (optional)' },
      },
      required: ['question'],
    },
  },
  {
    name: 'report_progress',
    description:
      'Report a progress message to the user. Use sparingly for major milestones only.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'A short progress update' },
      },
      required: ['message'],
    },
  },
]

// ── Tool implementations ──────────────────────────────────────────────────

function cleanupClarifyFiles() {
  try { unlinkSync(QUESTION_FILE) } catch {}
  try { unlinkSync(REPLY_FILE) } catch {}
}

function pollForReply() {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const timer = setInterval(() => {
      try {
        if (existsSync(REPLY_FILE)) {
          const reply = readFileSync(REPLY_FILE, 'utf-8').trim()
          if (reply) {
            clearInterval(timer)
            cleanupClarifyFiles()
            resolve(reply)
            return
          }
        }
      } catch {}
      if (Date.now() - start > POLL_TIMEOUT) {
        clearInterval(timer)
        cleanupClarifyFiles()
        reject(new Error('Timed out waiting for user reply (25 min)'))
      }
    }, POLL_INTERVAL)
  })
}

async function handleAskUser(params) {
  const { question, context } = params
  cleanupClarifyFiles()
  writeFileSync(QUESTION_FILE, JSON.stringify({ question, context: context || null }))

  // Optional: notify Lumo backend via HTTP callback
  if (CALLBACK_URL) {
    try {
      await fetch(CALLBACK_URL + '/api/agent/mcp-clarify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(CALLBACK_TOKEN ? { Authorization: 'Bearer ' + CALLBACK_TOKEN } : {}),
        },
        body: JSON.stringify({ taskId: TASK_ID, question, context: context || null }),
      })
    } catch {}
  }

  const reply = await pollForReply()
  return { content: [{ type: 'text', text: reply }] }
}

async function handleReportProgress(params) {
  if (CALLBACK_URL) {
    try {
      await fetch(CALLBACK_URL + '/api/agent/mcp-progress', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(CALLBACK_TOKEN ? { Authorization: 'Bearer ' + CALLBACK_TOKEN } : {}),
        },
        body: JSON.stringify({ taskId: TASK_ID, message: params.message }),
      })
    } catch {}
  }
  return { content: [{ type: 'text', text: 'Progress reported.' }] }
}

// ── MCP protocol handler ─────────────────────────────────────────────────

async function handleRequest(msg) {
  const { id, method, params } = msg

  switch (method) {
    case 'initialize':
      return ok(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'lumo-sandbox', version: '1.0.0' },
      })

    case 'notifications/initialized':
      // Client acknowledgement — no response needed
      return

    case 'tools/list':
      return ok(id, { tools: TOOLS })

    case 'tools/call': {
      const toolName = params?.name
      const toolArgs = params?.arguments ?? {}
      try {
        if (toolName === 'ask_user') {
          const result = await handleAskUser(toolArgs)
          return ok(id, result)
        }
        if (toolName === 'report_progress') {
          const result = await handleReportProgress(toolArgs)
          return ok(id, result)
        }
        return err(id, -32601, 'Unknown tool: ' + toolName)
      } catch (e) {
        return err(id, -32000, e.message || 'Tool execution failed')
      }
    }

    case 'ping':
      return ok(id, {})

    default:
      if (id != null) {
        return err(id, -32601, 'Method not found: ' + method)
      }
      // Notification — no response
  }
}

// ── stdio transport (Content-Length framing) ──────────────────────────────

let buffer = ''

process.stdin.setEncoding('utf-8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  while (true) {
    const headerEnd = buffer.indexOf('\\r\\n\\r\\n')
    if (headerEnd === -1) break
    const header = buffer.slice(0, headerEnd)
    const match = header.match(/Content-Length:\\s*(\\d+)/)
    if (!match) { buffer = buffer.slice(headerEnd + 4); continue }
    const len = parseInt(match[1], 10)
    const bodyStart = headerEnd + 4
    if (buffer.length < bodyStart + len) break
    const body = buffer.slice(bodyStart, bodyStart + len)
    buffer = buffer.slice(bodyStart + len)
    try {
      handleRequest(JSON.parse(body))
    } catch {}
  }
})

process.stderr.write('[lumo-sandbox-mcp] Server started\\n')
`

// ── Config generation ─────────────────────────────────────────────────────

function buildMcpConfig(): string {
  return JSON.stringify(
    {
      mcpServers: {
        'lumo-sandbox': {
          command: 'node',
          args: ['/home/user/mcp-server.mjs'],
        },
      },
    },
    null,
    2
  )
}

// ── Public API ────────────────────────────────────────────────────────────

export interface McpEnvVars {
  callbackUrl?: string | undefined
  callbackToken?: string | undefined
  taskId: string
}

/**
 * Write the MCP server code and config into the sandbox.
 * Must be called after sandbox creation but before launching Claude Code.
 */
export async function installMcpServer(
  sandbox: Sandbox,
  env: McpEnvVars
): Promise<void> {
  // Inject env vars into the server source
  let source = MCP_SERVER_SOURCE
  if (env.callbackUrl) {
    source = source.replace(
      "const CALLBACK_URL  = process.env.LUMO_CALLBACK_URL || ''",
      `const CALLBACK_URL  = process.env.LUMO_CALLBACK_URL || '${env.callbackUrl}'`
    )
  }
  if (env.callbackToken) {
    source = source.replace(
      "const CALLBACK_TOKEN = process.env.LUMO_CALLBACK_TOKEN || ''",
      `const CALLBACK_TOKEN = process.env.LUMO_CALLBACK_TOKEN || '${env.callbackToken}'`
    )
  }
  source = source.replace(
    "const TASK_ID       = process.env.LUMO_TASK_ID || ''",
    `const TASK_ID       = process.env.LUMO_TASK_ID || '${env.taskId}'`
  )

  await sandbox.files.write('/home/user/mcp-server.mjs', source)
  await sandbox.files.write('/home/user/mcp-config.json', buildMcpConfig())
}

/** The --mcp-config flag to append to the Claude CLI command. */
export const MCP_CONFIG_PATH = '/home/user/mcp-config.json'
