import { Sandbox } from '@e2b/code-interpreter'
import { installMcpServer } from '../lib/agent/sandbox-mcp'

/**
 * Smoke test: verify the MCP server runs inside an E2B sandbox,
 * speaks JSON-RPC correctly, and the ask_user tool works end-to-end.
 */

// ── JSON-RPC helpers ──────────────────────────────────────────────────────

function jsonRpcRequest(id: number, method: string, params?: unknown): string {
  const body = JSON.stringify({ jsonrpc: '2.0', id, method, params })
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
}

function parseJsonRpcResponse(raw: string): unknown {
  // Extract JSON from Content-Length framed response
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) throw new Error(`No JSON found in response: ${raw}`)
  return JSON.parse(match[0])
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
  console.log('Creating sandbox...')
  const sandbox = await Sandbox.create({ timeoutMs: 5 * 60 * 1000 })
  console.log(`Sandbox ID: ${sandbox.sandboxId}\n`)

  try {
    // ── Test 1: Install MCP server ────────────────────────────────────
    console.log('--- Test 1: Install MCP server files ---')
    await installMcpServer(sandbox, {
      taskId: 'test-task-123',
      callbackUrl: 'https://example.com',
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

    // ── Test 2: MCP server starts and responds to initialize ─────────
    console.log('\n--- Test 2: MCP server protocol - initialize ---')

    // Start MCP server as a background process that reads from a pipe
    await sandbox.commands.run('mkfifo /tmp/mcp-input 2>/dev/null; true')

    // Send initialize request through the pipe
    const initRequest = jsonRpcRequest(1, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0.0' },
    })

    // Write input to pipe and capture output
    // We run the server with a timeout and pipe input to it
    await sandbox.files.write('/tmp/mcp-test-input.txt', initRequest)

    const initResult = await sandbox.commands.run(
      'cat /tmp/mcp-test-input.txt | timeout 5 node /home/user/mcp-server.mjs 2>/dev/null || true',
      { timeoutMs: 15000 }
    )

    const initResponse = parseJsonRpcResponse(initResult.stdout) as any
    assert(
      initResponse.result?.serverInfo?.name === 'lumo-sandbox',
      'Server name is lumo-sandbox'
    )
    assert(
      initResponse.result?.protocolVersion === '2024-11-05',
      'Protocol version matches'
    )
    assert(
      initResponse.result?.capabilities?.tools !== undefined,
      'Has tools capability'
    )

    // ── Test 3: tools/list returns ask_user and report_progress ──────
    console.log('\n--- Test 3: MCP server protocol - tools/list ---')

    const listRequest =
      jsonRpcRequest(1, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0.0' },
      }) + jsonRpcRequest(2, 'tools/list', {})

    await sandbox.files.write('/tmp/mcp-test-input.txt', listRequest)

    const listResult = await sandbox.commands.run(
      'cat /tmp/mcp-test-input.txt | timeout 5 node /home/user/mcp-server.mjs 2>/dev/null || true',
      { timeoutMs: 15000 }
    )

    // Find the tools/list response (id: 2)
    const allResponses =
      listResult.stdout.match(/\{[^{}]*"id"\s*:\s*2[^{}]*\{[\s\S]*?\}\s*\}/g) ||
      listResult.stdout.match(/\{[\s\S]*?"id"\s*:\s*2[\s\S]*?\}\s*$/g)

    // Parse all JSON objects from the output
    const jsonObjects: any[] = []
    const jsonRegex = /\{[^]*?"jsonrpc"[^]*?\}/g
    let match
    let remaining = listResult.stdout
    while (remaining) {
      const clMatch = remaining.match(/Content-Length:\s*(\d+)\r?\n\r?\n/)
      if (!clMatch) break
      const len = parseInt(clMatch[1], 10)
      const bodyStart = clMatch.index! + clMatch[0].length
      const body = remaining.slice(bodyStart, bodyStart + len)
      try {
        jsonObjects.push(JSON.parse(body))
      } catch {}
      remaining = remaining.slice(bodyStart + len)
    }

    const toolsResponse = jsonObjects.find((r: any) => r.id === 2)
    const toolNames = (toolsResponse?.result?.tools ?? []).map(
      (t: any) => t.name
    )
    assert(toolNames.includes('ask_user'), 'Has ask_user tool')
    assert(toolNames.includes('report_progress'), 'Has report_progress tool')

    // ── Test 4: ask_user writes question file and reads reply ────────
    console.log('\n--- Test 4: ask_user end-to-end flow ---')

    // Clean up any leftover files
    await sandbox.commands.run(
      'rm -f /tmp/clarify-question.txt /tmp/clarify-reply.txt'
    )

    const askRequest =
      jsonRpcRequest(1, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0.0' },
      }) +
      jsonRpcRequest(2, 'notifications/initialized', undefined) +
      jsonRpcRequest(3, 'tools/call', {
        name: 'ask_user',
        arguments: {
          question: 'Which database should I use?',
          context: 'Spec mentions persistence but no DB specified',
        },
      })

    await sandbox.files.write('/tmp/mcp-test-input.txt', askRequest)

    // Start MCP server in background (it will block on ask_user polling)
    const askPromise = sandbox.commands.run(
      'cat /tmp/mcp-test-input.txt | timeout 30 node /home/user/mcp-server.mjs 2>/dev/null || true',
      { timeoutMs: 40000 }
    )

    // Wait 6s then write the reply file from the "Lumo side"
    // (ask_user polls every 5s, so 6s guarantees at least one poll cycle)
    await new Promise(resolve => setTimeout(resolve, 6000))
    await sandbox.files.write(
      '/tmp/clarify-reply.txt',
      'Use PostgreSQL, not MySQL.'
    )
    console.log('  [info] Reply file written by test after 6s delay')

    // Now wait for the MCP server to pick up the reply and respond
    const askResult = await askPromise

    // Parse responses
    const askObjects: any[] = []
    let askRemaining = askResult.stdout
    while (askRemaining) {
      const clMatch = askRemaining.match(/Content-Length:\s*(\d+)\r?\n\r?\n/)
      if (!clMatch) break
      const len = parseInt(clMatch[1], 10)
      const bodyStart = clMatch.index! + clMatch[0].length
      const body = askRemaining.slice(bodyStart, bodyStart + len)
      try {
        askObjects.push(JSON.parse(body))
      } catch {}
      askRemaining = askRemaining.slice(bodyStart + len)
    }

    const askResponse = askObjects.find((r: any) => r.id === 3)

    // Debug: show raw output and parsed objects
    if (!askResponse) {
      console.log('  [debug] Raw stdout length:', askResult.stdout.length)
      console.log('  [debug] Raw stderr:', askResult.stderr?.slice(0, 200))
      console.log(
        '  [debug] Parsed objects:',
        JSON.stringify(
          askObjects.map((o: any) => ({
            id: o.id,
            hasResult: !!o.result,
            hasError: !!o.error,
          }))
        )
      )
      console.log('  [debug] Exit code:', askResult.exitCode)
      // Check if question file was written
      const qFile = await sandbox.commands.run(
        'cat /tmp/clarify-question.txt 2>/dev/null || echo "NOT_FOUND"'
      )
      console.log('  [debug] Question file:', qFile.stdout.trim().slice(0, 100))
      const rFile = await sandbox.commands.run(
        'cat /tmp/clarify-reply.txt 2>/dev/null || echo "NOT_FOUND"'
      )
      console.log('  [debug] Reply file:', rFile.stdout.trim().slice(0, 100))
    }

    assert(askResponse !== undefined, 'Got response for ask_user call')
    if (askResponse) {
      const replyText = askResponse.result?.content?.[0]?.text
      assert(
        replyText === 'Use PostgreSQL, not MySQL.',
        `ask_user returned correct reply: "${replyText}"`
      )
    }

    // ── Test 5: Verify question file content ────────────────────────
    console.log('\n--- Test 5: Question file format ---')

    // Clean up and test just the question file writing
    await sandbox.commands.run(
      'rm -f /tmp/clarify-question.txt /tmp/clarify-reply.txt'
    )

    // We'll use report_progress instead (doesn't block)
    const progressRequest =
      jsonRpcRequest(1, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0.0' },
      }) +
      jsonRpcRequest(2, 'tools/call', {
        name: 'report_progress',
        arguments: { message: 'Analyzing codebase structure' },
      })

    await sandbox.files.write('/tmp/mcp-test-input.txt', progressRequest)

    const progressResult = await sandbox.commands.run(
      'cat /tmp/mcp-test-input.txt | timeout 5 node /home/user/mcp-server.mjs 2>/dev/null || true',
      { timeoutMs: 15000 }
    )

    const progressObjects: any[] = []
    let pRemaining = progressResult.stdout
    while (pRemaining) {
      const clMatch = pRemaining.match(/Content-Length:\s*(\d+)\r?\n\r?\n/)
      if (!clMatch) break
      const len = parseInt(clMatch[1], 10)
      const bodyStart = clMatch.index! + clMatch[0].length
      const body = pRemaining.slice(bodyStart, bodyStart + len)
      try {
        progressObjects.push(JSON.parse(body))
      } catch {}
      pRemaining = pRemaining.slice(bodyStart + len)
    }

    const progressResponse = progressObjects.find((r: any) => r.id === 2)
    assert(progressResponse !== undefined, 'Got response for report_progress')
    if (progressResponse) {
      assert(
        progressResponse.result?.content?.[0]?.text === 'Progress reported.',
        'report_progress returned confirmation'
      )
    }

    // ── Summary ─────────────────────────────────────────────────────
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
    console.log('Done.')
  }

  if (failed > 0) process.exit(1)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
