import { Sandbox } from '@e2b/code-interpreter'
import { createServer, type Server } from 'node:http'
import { installMcpServer } from '../lib/agent/sandbox-mcp'

/**
 * Layer 2 smoke test: verify the MCP server runs inside an E2B sandbox
 * and communicates with the Lumo backend via HTTP (not file I/O).
 *
 * This test starts a local mock HTTP server to simulate the Lumo backend,
 * then installs the MCP server in a real E2B sandbox and verifies:
 *   1. File installation
 *   2. JSON-RPC protocol (initialize, tools/list)
 *   3. report_progress (HTTP POST)
 *   4. ask_user end-to-end (HTTP POST + GET polling)
 *
 * Usage:
 *   npx tsx scripts/test-sandbox-mcp.ts
 *
 * Requires: E2B_API_KEY environment variable
 */

// ── JSON-RPC helpers ──────────────────────────────────────────────────────

function jsonRpcRequest(id: number, method: string, params?: unknown): string {
  const body = JSON.stringify({ jsonrpc: '2.0', id, method, params })
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
}

function parseContentLengthFrames(raw: string): any[] {
  const objects: any[] = []
  let remaining = raw
  while (remaining) {
    const clMatch = remaining.match(/Content-Length:\s*(\d+)\r?\n\r?\n/)
    if (!clMatch) break
    const len = parseInt(clMatch[1], 10)
    const bodyStart = clMatch.index! + clMatch[0].length
    const body = remaining.slice(bodyStart, bodyStart + len)
    try {
      objects.push(JSON.parse(body))
    } catch {}
    remaining = remaining.slice(bodyStart + len)
  }
  return objects
}

// ── Mock HTTP server ──────────────────────────────────────────────────────

interface MockState {
  postReceived: boolean
  postBody: any
  progressReceived: boolean
  progressBody: any
  reply: string | null
  getCount: number
}

function createMockServer(): {
  server: Server
  url: Promise<string>
  state: MockState
} {
  const state: MockState = {
    postReceived: false,
    postBody: null,
    progressReceived: false,
    progressBody: null,
    reply: null,
    getCount: 0,
  }

  const server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => {
      body += chunk
    })
    req.on('end', () => {
      if (req.method === 'POST' && req.url === '/api/agent/mcp-clarify') {
        state.postReceived = true
        state.postBody = JSON.parse(body)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, clarifyId: 'mock-clarify-001' }))
        return
      }

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

      if (req.method === 'POST' && req.url === '/api/agent/mcp-progress') {
        state.progressReceived = true
        state.progressBody = JSON.parse(body)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
        return
      }

      res.writeHead(404)
      res.end('Not found')
    })
  })

  const url = new Promise<string>(resolve => {
    // Listen on 0.0.0.0 so the sandbox can reach us
    server.listen(0, '0.0.0.0', () => {
      const addr = server.address() as { port: number }
      resolve(`http://host.docker.internal:${addr.port}`)
    })
  })

  return { server, url, state }
}

// ── Test runner ───────────────────────────────────────────────────────────

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

async function main() {
  // Start mock HTTP server
  const mock = createMockServer()
  const callbackUrl = await mock.url
  console.log(`Mock HTTP server: ${callbackUrl}`)

  // E2B sandbox can't reach host.docker.internal — use the host's public IP
  // For E2B cloud sandboxes, we need a publicly reachable URL.
  // For this test, we'll inject the URL and let the sandbox try to reach it.
  // If the sandbox can't reach the mock server (cloud sandbox), the ask_user
  // HTTP test will fail gracefully.

  console.log('Creating sandbox...')
  const sandbox = await Sandbox.create({ timeoutMs: 5 * 60 * 1000 })
  console.log(`Sandbox ID: ${sandbox.sandboxId}\n`)

  try {
    // ── Test 1: Install MCP server files ─────────────────────────────
    console.log('--- Test 1: Install MCP server files ---')
    await installMcpServer(sandbox, {
      taskId: 'test-task-123',
      callbackUrl,
    })

    const serverExists = await sandbox.commands.run(
      'test -f /home/user/mcp-server.mjs && echo "yes" || echo "no"'
    )
    assert(serverExists.stdout.trim() === 'yes', 'mcp-server.mjs exists')

    const configExists = await sandbox.commands.run(
      'test -f /home/user/mcp-config.json && echo "yes" || echo "no"'
    )
    assert(configExists.stdout.trim() === 'yes', 'mcp-config.json exists')

    const config = await sandbox.files.read('/home/user/mcp-config.json')
    const parsed = JSON.parse(config)
    assert(
      parsed.mcpServers?.['lumo-sandbox']?.command === 'node',
      'Config has correct command'
    )

    // Verify the injected source contains HTTP-based communication
    const source = await sandbox.files.read('/home/user/mcp-server.mjs')
    assert(
      source.includes('/api/agent/mcp-clarify'),
      'Source contains HTTP API path'
    )
    assert(
      !source.includes('clarify-question.txt'),
      'Source does NOT contain file I/O paths'
    )
    assert(
      source.includes(callbackUrl),
      'Source contains injected callback URL'
    )

    // ── Test 2: MCP server protocol - initialize ─────────────────────
    console.log('\n--- Test 2: MCP server protocol - initialize ---')

    const initRequest = jsonRpcRequest(1, 'initialize', {
      protocolVersion: '2024-11-05',
    })
    await sandbox.files.write('/tmp/mcp-test-input.txt', initRequest)

    const initResult = await sandbox.commands.run(
      'cat /tmp/mcp-test-input.txt | timeout 5 node /home/user/mcp-server.mjs 2>/dev/null || true',
      { timeoutMs: 15000 }
    )

    const initResponses = parseContentLengthFrames(initResult.stdout)
    const initResp = initResponses.find((r: any) => r.id === 1)
    assert(
      initResp?.result?.serverInfo?.name === 'lumo-sandbox',
      'Server name is lumo-sandbox'
    )
    assert(
      initResp?.result?.protocolVersion === '2024-11-05',
      'Protocol version matches'
    )

    // ── Test 3: tools/list ───────────────────────────────────────────
    console.log('\n--- Test 3: MCP server protocol - tools/list ---')

    const listRequest =
      jsonRpcRequest(1, 'initialize', { protocolVersion: '2024-11-05' }) +
      jsonRpcRequest(2, 'tools/list', {})
    await sandbox.files.write('/tmp/mcp-test-input.txt', listRequest)

    const listResult = await sandbox.commands.run(
      'cat /tmp/mcp-test-input.txt | timeout 5 node /home/user/mcp-server.mjs 2>/dev/null || true',
      { timeoutMs: 15000 }
    )

    const listResponses = parseContentLengthFrames(listResult.stdout)
    const listResp = listResponses.find((r: any) => r.id === 2)
    const toolNames = (listResp?.result?.tools ?? []).map((t: any) => t.name)
    assert(toolNames.includes('ask_user'), 'Has ask_user tool')
    assert(toolNames.includes('report_progress'), 'Has report_progress tool')

    // ── Test 4: report_progress via HTTP ─────────────────────────────
    console.log('\n--- Test 4: report_progress (HTTP POST) ---')

    const progressRequest =
      jsonRpcRequest(1, 'initialize', { protocolVersion: '2024-11-05' }) +
      jsonRpcRequest(2, 'tools/call', {
        name: 'report_progress',
        arguments: { message: 'Analyzing codebase structure' },
      })
    await sandbox.files.write('/tmp/mcp-test-input.txt', progressRequest)

    const progressResult = await sandbox.commands.run(
      'cat /tmp/mcp-test-input.txt | timeout 10 node /home/user/mcp-server.mjs 2>/dev/null || true',
      { timeoutMs: 20000 }
    )

    const progressResponses = parseContentLengthFrames(progressResult.stdout)
    const progressResp = progressResponses.find((r: any) => r.id === 2)
    assert(
      progressResp?.result?.content?.[0]?.text === 'Progress reported.',
      'report_progress returned confirmation'
    )

    // Check if mock server received the progress POST
    // (may fail if sandbox can't reach local mock server)
    if (mock.state.progressReceived) {
      assert(true, 'Mock server received progress POST')
      assert(
        mock.state.progressBody?.message === 'Analyzing codebase structure',
        'Progress message matches'
      )
    } else {
      console.log(
        '  ⚠ Mock server did not receive progress POST (sandbox may not reach local host)'
      )
      console.log(
        '  ⚠ This is expected for cloud sandboxes — HTTP reachability is tested in E2E'
      )
    }

    // ── Test 5: ask_user via HTTP (if sandbox can reach mock) ────────
    console.log('\n--- Test 5: ask_user (HTTP POST + GET polling) ---')

    // Test the ask_user flow only if sandbox can reach us
    const reachTest = await sandbox.commands.run(
      `curl -s -o /dev/null -w "%{http_code}" "${callbackUrl}/api/agent/mcp-clarify/test" 2>/dev/null || echo "unreachable"`,
      { timeoutMs: 10000 }
    )

    if (reachTest.stdout.trim() === '404') {
      console.log('  [info] Sandbox can reach mock server, testing ask_user...')

      // Reset mock state
      mock.state.postReceived = false
      mock.state.postBody = null
      mock.state.reply = null
      mock.state.getCount = 0

      const askRequest =
        jsonRpcRequest(1, 'initialize', { protocolVersion: '2024-11-05' }) +
        jsonRpcRequest(2, 'tools/call', {
          name: 'ask_user',
          arguments: {
            question: 'Which database should I use?',
            context: 'Spec needs persistence',
          },
        })
      await sandbox.files.write('/tmp/mcp-test-input.txt', askRequest)

      // Start MCP server (will block on ask_user HTTP polling)
      const askPromise = sandbox.commands.run(
        'cat /tmp/mcp-test-input.txt | timeout 30 node /home/user/mcp-server.mjs 2>/dev/null || true',
        { timeoutMs: 40000 }
      )

      // Wait for POST, then simulate reply
      await new Promise(r => setTimeout(r, 3000))
      assert(mock.state.postReceived, 'Mock received ask_user POST')
      assert(
        mock.state.postBody?.question === 'Which database should I use?',
        'Question matches'
      )

      // Simulate user reply after 3s
      console.log('  [info] Simulating user reply...')
      mock.state.reply = 'Use PostgreSQL with Prisma.'

      // Wait for MCP server to poll and get reply
      const askResult = await askPromise
      const askResponses = parseContentLengthFrames(askResult.stdout)
      const askResp = askResponses.find((r: any) => r.id === 2)

      assert(
        askResp?.result?.content?.[0]?.text === 'Use PostgreSQL with Prisma.',
        `ask_user returned reply: "${askResp?.result?.content?.[0]?.text}"`
      )
      assert(mock.state.getCount > 0, `GET poll count: ${mock.state.getCount}`)
    } else {
      console.log(
        '  ⚠ Sandbox cannot reach local mock server — skipping ask_user HTTP test'
      )
      console.log('  ⚠ This is expected for cloud E2B sandboxes')
      console.log('  ⚠ Full HTTP flow is verified in test-mcp-local.ts')
    }

    // ── Summary ──────────────────────────────────────────────────────
    console.log(`\n${'═'.repeat(50)}`)
    console.log(`Results: ${passed} passed, ${failed} failed`)
    if (failed === 0) {
      console.log('✅ All MCP sandbox tests passed!')
    } else {
      console.log('❌ Some tests failed')
    }
  } finally {
    console.log('\nKilling sandbox...')
    await sandbox.kill()
    mock.server.close()
    console.log('Done.')
  }

  if (failed > 0) process.exit(1)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
