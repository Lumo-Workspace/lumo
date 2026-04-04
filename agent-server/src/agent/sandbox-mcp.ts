/**
 * Generates the MCP server code and config to inject into the E2B sandbox.
 */

import type { Sandbox } from '@e2b/code-interpreter'

// ── MCP server source (injected as a single .mjs file) ────────────────────

const MCP_SERVER_SOURCE = `#!/usr/bin/env node
// Lumo Sandbox MCP Server — zero dependencies, JSON-RPC 2.0 over stdio

const POLL_INTERVAL = 5000
const POLL_TIMEOUT  = 25 * 60000
const CALLBACK_URL  = process.env.LUMO_CALLBACK_URL || ''
const CALLBACK_TOKEN = process.env.LUMO_CALLBACK_TOKEN || ''
const TASK_ID       = process.env.LUMO_TASK_ID || ''
const MAX_RETRIES   = 3

let useContentLength = false

function send(obj) {
  const body = JSON.stringify(obj)
  if (useContentLength) {
    process.stdout.write('Content-Length: ' + Buffer.byteLength(body) + '\\r\\n\\r\\n' + body)
  } else {
    process.stdout.write(body + '\\n')
  }
  debug('sent: ' + body.slice(0, 200))
}

function ok(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

function err(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

function authHeaders() {
  const h = { 'Content-Type': 'application/json' }
  if (CALLBACK_TOKEN) h['Authorization'] = 'Bearer ' + CALLBACK_TOKEN
  return h
}

async function httpPost(path, body) {
  const res = await fetch(CALLBACK_URL + path, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('POST ' + path + ' failed: ' + res.status)
  return res.json()
}

async function httpGet(path) {
  const res = await fetch(CALLBACK_URL + path, {
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error('GET ' + path + ' failed: ' + res.status)
  return res.json()
}

async function httpWithRetry(fn) {
  let lastErr
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      debug('HTTP retry ' + (i + 1) + '/' + MAX_RETRIES + ': ' + e.message)
      if (i < MAX_RETRIES - 1) await new Promise(r => setTimeout(r, 2000 * (i + 1)))
    }
  }
  throw lastErr
}

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

async function pollForReply(clarifyId) {
  const start = Date.now()
  while (Date.now() - start < POLL_TIMEOUT) {
    try {
      const data = await httpGet('/api/agent/mcp-clarify/' + clarifyId)
      if (data.status === 'replied' && data.reply) {
        return data.reply
      }
    } catch (e) {
      debug('Poll error (will retry): ' + e.message)
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL))
  }
  throw new Error('Timed out waiting for user reply (25 min)')
}

async function handleAskUser(params) {
  const { question, context } = params
  if (!CALLBACK_URL) {
    throw new Error('CALLBACK_URL is not configured — cannot ask user')
  }
  const result = await httpWithRetry(() =>
    httpPost('/api/agent/mcp-clarify', {
      taskId: TASK_ID,
      question,
      context: context || null,
    })
  )
  const clarifyId = result.clarifyId
  if (!clarifyId) throw new Error('Backend did not return clarifyId')
  debug('Clarify created: ' + clarifyId + ', polling for reply...')
  const reply = await pollForReply(clarifyId)
  debug('Got reply: ' + reply.slice(0, 100))
  return { content: [{ type: 'text', text: reply }] }
}

async function handleReportProgress(params) {
  if (CALLBACK_URL) {
    try {
      await httpPost('/api/agent/mcp-progress', {
        taskId: TASK_ID,
        message: params.message,
      })
    } catch {}
  }
  return { content: [{ type: 'text', text: 'Progress reported.' }] }
}

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
  }
}

const DEBUG_LOG = '/tmp/mcp-debug.log'
function debug(msg) {
  try {
    const { appendFileSync } = require('node:fs')
    appendFileSync(DEBUG_LOG, new Date().toISOString() + ' ' + msg + '\\n')
  } catch {}
}

let buffer = ''

function processBuffer() {
  while (buffer.length > 0) {
    const clMatch = buffer.match(/^Content-Length:\\s*(\\d+)\\r?\\n\\r?\\n/)
    if (clMatch) {
      useContentLength = true
      const len = parseInt(clMatch[1], 10)
      const bodyStart = clMatch[0].length
      if (buffer.length < bodyStart + len) return
      const body = buffer.slice(bodyStart, bodyStart + len)
      buffer = buffer.slice(bodyStart + len)
      debug('CL message: ' + body.slice(0, 200))
      try { handleRequest(JSON.parse(body)) } catch (e) { debug('CL parse error: ' + e.message) }
      continue
    }

    const nlIndex = buffer.indexOf('\\n')
    if (nlIndex === -1) return
    const line = buffer.slice(0, nlIndex).trim()
    buffer = buffer.slice(nlIndex + 1)
    if (!line) continue
    debug('NL message: ' + line.slice(0, 200))
    try { handleRequest(JSON.parse(line)) } catch (e) { debug('NL parse error: ' + e.message) }
  }
}

process.stdin.setEncoding('utf-8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  processBuffer()
})

process.stderr.write('[lumo-sandbox-mcp] Server started\\n')
debug('Server started, waiting for input...')
`

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

export interface McpEnvVars {
  callbackUrl: string
  callbackToken?: string | undefined
  taskId: string
}

export async function installMcpServer(
  sandbox: Sandbox,
  env: McpEnvVars
): Promise<void> {
  let source = MCP_SERVER_SOURCE
  source = source.replace(
    "const CALLBACK_URL  = process.env.LUMO_CALLBACK_URL || ''",
    `const CALLBACK_URL  = process.env.LUMO_CALLBACK_URL || '${env.callbackUrl}'`
  )
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

export const MCP_CONFIG_PATH = '/home/user/mcp-config.json'
