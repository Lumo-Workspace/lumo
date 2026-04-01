/**
 * Local MCP server test — no E2B sandbox needed.
 *
 * Extracts the MCP server source from sandbox-mcp.ts, spawns it as a
 * child process, and sends JSON-RPC messages over stdin/stdout.
 *
 * Usage:
 *   npx tsx scripts/test-mcp-local.ts
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ── Extract MCP server source ────────────────────────────────────────────────

function extractServerSource(): string {
  const srcPath = join(__dirname, '..', 'lib', 'agent', 'sandbox-mcp.ts')
  const src = readFileSync(srcPath, 'utf-8')
  const match = src.match(/const MCP_SERVER_SOURCE = `([\s\S]*?)`\n/)
  if (!match)
    throw new Error('Could not extract MCP_SERVER_SOURCE from sandbox-mcp.ts')
  // Unescape template literal escapes
  return match[1]
    .replace(/\\`/g, '`')
    .replace(/\\\$/g, '$')
    .replace(/\\\\/g, '\\')
}

// ── JSON-RPC helpers ─────────────────────────────────────────────────────────

function frameContentLength(obj: unknown): string {
  const body = JSON.stringify(obj)
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
}

function frameNewlineDelimited(obj: unknown): string {
  return JSON.stringify(obj) + '\n'
}

function jsonRpc(id: number, method: string, params?: unknown) {
  return { jsonrpc: '2.0' as const, id, method, params }
}

// ── MCP process wrapper ──────────────────────────────────────────────────────

class McpTestClient {
  private proc: ChildProcess
  private buffer = Buffer.alloc(0)
  private responses: Map<number, unknown> = new Map()
  private waiters: Map<number, (value: unknown) => void> = new Map()
  private useContentLength: boolean

  constructor(serverPath: string, useContentLength = true) {
    this.useContentLength = useContentLength
    this.proc = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        LUMO_TASK_ID: 'local-test',
        LUMO_CALLBACK_URL: '', // no callback for local test
      },
    })

    // Read stdout as raw buffers for correct Content-Length handling
    this.proc.stdout!.on('data', (chunk: Buffer) => this.onData(chunk))
    this.proc.stderr!.on('data', (chunk: Buffer) => {
      const msg = chunk.toString().trim()
      if (msg) console.log(`  [stderr] ${msg}`)
    })
  }

  private onData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    this.parseBuffer()
  }

  private parseBuffer() {
    while (this.buffer.length > 0) {
      const str = this.buffer.toString('utf-8')
      if (this.useContentLength) {
        const clMatch = str.match(/^Content-Length:\s*(\d+)\r?\n\r?\n/)
        if (!clMatch) return
        const len = parseInt(clMatch[1], 10)
        const headerBytes = Buffer.byteLength(clMatch[0], 'utf-8')
        if (this.buffer.length < headerBytes + len) return
        const body = this.buffer
          .slice(headerBytes, headerBytes + len)
          .toString('utf-8')
        this.buffer = this.buffer.slice(headerBytes + len)
        this.handleMessage(body)
      } else {
        const nlIndex = str.indexOf('\n')
        if (nlIndex === -1) return
        const line = str.slice(0, nlIndex).trim()
        const lineBytes = Buffer.byteLength(str.slice(0, nlIndex + 1), 'utf-8')
        this.buffer = this.buffer.slice(lineBytes)
        if (!line) continue
        this.handleMessage(line)
      }
    }
  }

  private handleMessage(raw: string) {
    try {
      const msg = JSON.parse(raw) as { id?: number }
      if (msg.id != null) {
        this.responses.set(msg.id, msg)
        const waiter = this.waiters.get(msg.id)
        if (waiter) {
          this.waiters.delete(msg.id)
          waiter(msg)
        }
      }
    } catch (e) {
      console.log(`  [parse error] ${raw.slice(0, 100)}`)
    }
  }

  send(id: number, method: string, params?: unknown): void {
    const msg = jsonRpc(id, method, params)
    const frame = this.useContentLength
      ? frameContentLength(msg)
      : frameNewlineDelimited(msg)
    this.proc.stdin!.write(frame)
  }

  /** Send a notification (no id, no response expected) */
  notify(method: string, params?: unknown): void {
    const msg = { jsonrpc: '2.0' as const, method, params }
    const frame = this.useContentLength
      ? frameContentLength(msg)
      : frameNewlineDelimited(msg)
    this.proc.stdin!.write(frame)
  }

  async waitForResponse(id: number, timeoutMs = 10000): Promise<any> {
    // Already received?
    if (this.responses.has(id)) return this.responses.get(id)

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id)
        reject(new Error(`Timeout waiting for response id=${id}`))
      }, timeoutMs)

      this.waiters.set(id, msg => {
        clearTimeout(timer)
        resolve(msg)
      })
    })
  }

  kill() {
    this.proc.kill('SIGTERM')
  }
}

// ── Test runner ──────────────────────────────────────────────────────────────

let passed = 0
let failed = 0

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`)
    passed++
  } else {
    console.log(`  ✗ ${message}`)
    failed++
  }
}

// ── Mock HTTP server (simulates Lumo backend) ───────────────────────────────

interface MockState {
  postReceived: boolean
  postBody: any
  reply: string | null
  getCount: number
}

function createMockServer(): {
  server: Server
  port: Promise<number>
  state: MockState
} {
  const state: MockState = {
    postReceived: false,
    postBody: null,
    reply: null,
    getCount: 0,
  }

  const server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => {
      body += chunk
    })
    req.on('end', () => {
      // POST /api/agent/mcp-clarify — create clarify record
      if (req.method === 'POST' && req.url === '/api/agent/mcp-clarify') {
        state.postReceived = true
        state.postBody = JSON.parse(body)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, clarifyId: 'mock-clarify-001' }))
        return
      }

      // GET /api/agent/mcp-clarify/:id — poll for reply
      if (
        req.method === 'GET' &&
        req.url?.startsWith('/api/agent/mcp-clarify/')
      ) {
        state.getCount++
        res.writeHead(200, { 'Content-Type': 'application/json' })
        if (state.reply) {
          res.end(JSON.stringify({ status: 'replied', reply: state.reply }))
        } else {
          res.end(JSON.stringify({ status: 'pending' }))
        }
        return
      }

      // POST /api/agent/mcp-progress — just acknowledge
      if (req.method === 'POST' && req.url === '/api/agent/mcp-progress') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
        return
      }

      res.writeHead(404)
      res.end('Not found')
    })
  })

  const port = new Promise<number>(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      resolve(addr.port)
    })
  })

  return { server, port, state }
}

let mockState: MockState

async function runTests(mode: 'content-length' | 'newline-delimited') {
  console.log(`\n${'═'.repeat(55)}`)
  console.log(`Testing MCP server (${mode} mode)`)
  console.log(`${'═'.repeat(55)}`)

  // Start mock HTTP server
  const mock = createMockServer()
  const mockPort = await mock.port
  mockState = mock.state
  const callbackUrl = `http://127.0.0.1:${mockPort}`
  console.log(`  [mock] HTTP server on ${callbackUrl}`)

  // Write server to temp file, inject CALLBACK_URL
  const serverPath = join(tmpdir(), `mcp-server-test-${Date.now()}.mjs`)
  let serverSource = extractServerSource()
  serverSource = serverSource.replace(
    "const CALLBACK_URL  = process.env.LUMO_CALLBACK_URL || ''",
    `const CALLBACK_URL  = process.env.LUMO_CALLBACK_URL || '${callbackUrl}'`
  )
  serverSource = serverSource.replace(
    "const TASK_ID       = process.env.LUMO_TASK_ID || ''",
    "const TASK_ID       = process.env.LUMO_TASK_ID || 'local-test'"
  )
  writeFileSync(serverPath, serverSource)

  const client = new McpTestClient(serverPath, mode === 'content-length')

  try {
    // ── Test 1: initialize ─────────────────────────────────────────────
    console.log('\n--- Test 1: initialize ---')
    client.send(1, 'initialize', { protocolVersion: '2024-11-05' })
    const initResp = await client.waitForResponse(1)
    assert(
      initResp.result?.serverInfo?.name === 'lumo-sandbox',
      'Server name is lumo-sandbox'
    )
    assert(
      initResp.result?.protocolVersion === '2024-11-05',
      'Protocol version matches'
    )
    assert(
      initResp.result?.capabilities?.tools !== undefined,
      'Has tools capability'
    )

    // Send initialized notification (no id, no response expected)
    client.notify('notifications/initialized')
    await new Promise(r => setTimeout(r, 200))

    // ── Test 2: tools/list ─────────────────────────────────────────────
    console.log('\n--- Test 2: tools/list ---')
    client.send(2, 'tools/list', {})
    const listResp = await client.waitForResponse(2)
    const toolNames = (listResp.result?.tools ?? []).map((t: any) => t.name)
    assert(toolNames.includes('ask_user'), 'Has ask_user tool')
    assert(toolNames.includes('report_progress'), 'Has report_progress tool')

    // ── Test 3: report_progress ────────────────────────────────────────
    console.log('\n--- Test 3: report_progress ---')
    client.send(3, 'tools/call', {
      name: 'report_progress',
      arguments: { message: 'Local test progress' },
    })
    const progressResp = await client.waitForResponse(3)
    assert(
      progressResp.result?.content?.[0]?.text === 'Progress reported.',
      'report_progress returns confirmation'
    )

    // ── Test 4: ask_user (with mock HTTP server) ───────────────────────
    console.log('\n--- Test 4: ask_user end-to-end (HTTP) ---')

    // Send ask_user — will POST to mock server, then poll GET until reply
    client.send(4, 'tools/call', {
      name: 'ask_user',
      arguments: {
        question: 'Which database should I use?',
        context: 'Spec mentions persistence but no DB specified',
      },
    })

    // Wait for the POST (question submission) and first GET poll
    await new Promise(r => setTimeout(r, 2000))
    assert(mockState.postReceived, 'POST /api/agent/mcp-clarify received')
    assert(
      mockState.postBody?.question === 'Which database should I use?',
      'Question matches'
    )
    assert(
      mockState.postBody?.context ===
        'Spec mentions persistence but no DB specified',
      'Context matches'
    )

    // Simulate user replying after 3 seconds
    console.log('  [info] Simulating user reply in 3s...')
    await new Promise(r => setTimeout(r, 3000))
    mockState.reply = 'Use PostgreSQL with Prisma.'

    // Wait for response (server polls every 5s, give it time)
    const askResp = await client.waitForResponse(4, 15000)
    assert(
      askResp.result?.content?.[0]?.text === 'Use PostgreSQL with Prisma.',
      `ask_user returned reply: "${askResp.result?.content?.[0]?.text}"`
    )
    assert(mockState.getCount > 0, `GET poll count: ${mockState.getCount}`)

    // ── Test 5: ping ───────────────────────────────────────────────────
    console.log('\n--- Test 5: ping ---')
    client.send(5, 'ping')
    const pingResp = await client.waitForResponse(5)
    assert(pingResp.result !== undefined, 'Ping returns empty result')

    // ── Test 6: unknown method ─────────────────────────────────────────
    console.log('\n--- Test 6: unknown method ---')
    client.send(6, 'nonexistent/method')
    const unknownResp = await client.waitForResponse(6)
    assert(unknownResp.error?.code === -32601, 'Unknown method returns -32601')
  } finally {
    client.kill()
    mock.server.close()
    try {
      require('node:fs').unlinkSync(serverPath)
    } catch {}
    // Reset mock state for next run
    mockState = {
      postReceived: false,
      postBody: null,
      reply: null,
      getCount: 0,
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔═══════════════════════════════════════════════════════╗')
  console.log('║   Local MCP Server Test (no sandbox needed)          ║')
  console.log('╚═══════════════════════════════════════════════════════╝')

  // Test both transport modes
  await runTests('content-length')
  await runTests('newline-delimited')

  // ── Summary ──────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(55)}`)
  console.log(`Results: ${passed} passed, ${failed} failed`)
  if (failed === 0) {
    console.log('✅ All local MCP tests passed!')
  } else {
    console.log('❌ Some tests failed — review output above')
  }

  if (failed > 0) process.exit(1)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
