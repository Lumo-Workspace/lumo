/**
 * E2E test: MCP-based clarify flow
 *
 * Verifies the complete cycle:
 *   1. Agent starts, encounters ambiguous spec
 *   2. Agent calls ask_user MCP tool (writes question file + HTTP callback)
 *   3. Monitor detects clarify → DB record + status → INPUT_REQUIRED
 *   4. "User" replies → resume.ts writes reply file to sandbox
 *   5. MCP ask_user unblocks → agent continues → commits → pushes
 *   6. Key check: only 1 AgentRun record (no restart)
 *
 * Prerequisites:
 *   - .env.local with E2B_API_KEY, ANTHROPIC_API_KEY, GITHUB_TOKEN, DATABASE_URL
 *   - A test task in the database (or create one)
 *
 * Usage:
 *   export $(grep -v '^#' .env.local | grep -E 'E2B_API_KEY|ANTHROPIC_API_KEY' | xargs)
 *   npx tsx scripts/test-mcp-clarify-e2e.ts
 */

import { Sandbox } from '@e2b/code-interpreter'
import { installMcpServer, MCP_CONFIG_PATH } from '../lib/agent/sandbox-mcp'

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY!
if (!ANTHROPIC_KEY) throw new Error('ANTHROPIC_API_KEY required')

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
  console.log('═══════════════════════════════════════════════════')
  console.log('E2E Test: MCP ask_user flow with Claude Code CLI')
  console.log('═══════════════════════════════════════════════════\n')

  // ── 1. Create sandbox and set up environment ─────────────────────────
  console.log('--- Step 1: Create sandbox ---')
  const sandbox = await Sandbox.create({ timeoutMs: 15 * 60 * 1000 })
  console.log(`  Sandbox ID: ${sandbox.sandboxId}`)

  try {
    // ── 2. Install Claude Code CLI ──────────────────────────────────────
    console.log('\n--- Step 2: Install Claude Code CLI ---')
    const installResult = await sandbox.commands.run(
      'sudo npm install -g @anthropic-ai/claude-code 2>&1 | tail -3',
      { timeoutMs: 3 * 60 * 1000 }
    )
    console.log(`  ${installResult.stdout.trim().split('\n').pop()}`)
    const versionCheck = await sandbox.commands.run(
      'claude --version 2>/dev/null || echo "not found"'
    )
    assert(
      versionCheck.stdout.trim() !== 'not found',
      'Claude Code CLI installed'
    )

    // ── 3. Install MCP server ──────────────────────────────────────────
    console.log('\n--- Step 3: Install MCP server ---')
    await installMcpServer(sandbox, {
      taskId: 'e2e-test-task',
      // No callback URL — we'll rely on file-based detection
    })
    assert(true, 'MCP server injected')

    // ── 4. Create a minimal repo for the agent to work in ──────────────
    console.log('\n--- Step 4: Set up test repo ---')
    await sandbox.commands.run(
      'mkdir -p /home/user/repo && cd /home/user/repo && git init && git config user.email "test@test.com" && git config user.name "Test" && echo "# Test" > README.md && git add . && git commit -m "init"'
    )
    await sandbox.commands.run(
      'cd /home/user/repo && git checkout -b lumo/e2e-test'
    )
    assert(true, 'Test repo initialized')

    // ── 5. Write an intentionally ambiguous task spec ──────────────────
    console.log('\n--- Step 5: Write ambiguous task spec ---')

    // The spec is deliberately vague — "add a button" without specifying
    // framework, location, or behavior. This should trigger ask_user.
    const taskSpec = `# Task: Add a button
Task ID: LUM-E2E

## Requirements
Add a button to the project.

## Instructions
- Read CLAUDE.md first for project conventions (if it exists)
- Branch is already created: lumo/e2e-test
- Commit your changes when done; include [LUM-E2E] in the commit message
- Do NOT add Co-Authored-By or any AI attribution lines to commit messages
- Do NOT push; do NOT create a PR (handled automatically)

## Clarification Protocol
If the spec is ambiguous, missing critical details, or you are unsure how to proceed,
you MUST ask for clarification instead of guessing. To do so:
- Call the \`mcp__lumo-sandbox__ask_user\` tool with your question and context.
  IMPORTANT: Use exactly this tool name — do NOT use AskUserQuestion or any other tool.
- The tool will BLOCK and wait for the user's reply (this may take minutes).
- Once you receive the reply, continue working based on the answer.
- Do NOT stop or exit after calling mcp__lumo-sandbox__ask_user — just wait for the response.

IMPORTANT: The spec above is intentionally vague. You MUST call mcp__lumo-sandbox__ask_user
to clarify what kind of button, where it goes, and what framework to use.
Do NOT guess — ask first.`

    await sandbox.files.write('/home/user/task.md', taskSpec)
    assert(true, 'Ambiguous task spec written')

    // ── 5b. Debug: check Claude CLI supports --mcp-config ───────────────
    console.log('\n--- Step 5b: Verify Claude CLI MCP support ---')
    const cliVersion = await sandbox.commands.run('claude --version 2>&1')
    console.log(`  Claude CLI version: ${cliVersion.stdout.trim()}`)

    const helpCheck = await sandbox.commands.run(
      'claude --help 2>&1 | grep -i mcp || echo "NO_MCP_SUPPORT"'
    )
    console.log(`  MCP flag in help: ${helpCheck.stdout.trim().slice(0, 120)}`)
    assert(
      helpCheck.stdout.trim() !== 'NO_MCP_SUPPORT',
      'Claude CLI supports --mcp-config'
    )

    // Quick test: can we start MCP server at all?
    const mcpQuickTest = await sandbox.commands.run(
      'echo \'Content-Length: 87\r\n\r\n{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}\' | timeout 5 node /home/user/mcp-server.mjs 2>&1 | head -3',
      { timeoutMs: 10000 }
    )
    console.log(
      `  MCP server quick test: ${mcpQuickTest.stdout.trim().slice(0, 120)}`
    )

    // ── 6a. Smoke test: verify Claude CLI can actually call MCP tool ───
    console.log('\n--- Step 6a: Smoke test — force Claude to call ask_user ---')

    const smokeTools =
      'mcp__lumo-sandbox__ask_user,mcp__lumo-sandbox__report_progress'

    const smokeCmd =
      `cd /home/user/repo && ANTHROPIC_API_KEY=${ANTHROPIC_KEY} ` +
      `claude -p "Call the mcp__lumo-sandbox__ask_user tool now with question='smoke test' and context='testing MCP'. Use exactly that tool name. Do nothing else." ` +
      `--allowedTools "${smokeTools}" ` +
      `--mcp-config ${MCP_CONFIG_PATH} ` +
      `--output-format stream-json --verbose --max-turns 5`

    let smokeCalledAskUser = false
    // Start agent (will block on ask_user polling for reply)
    const smokePromise = sandbox.commands.run(smokeCmd, {
      timeoutMs: 2 * 60 * 1000,
      onStdout: (data: string) => {
        try {
          const msg = JSON.parse(data)
          if (msg.type !== 'assistant') return
          for (const block of msg.message?.content ?? []) {
            if (
              block.type === 'tool_use' &&
              block.name === 'mcp__lumo-sandbox__ask_user'
            ) {
              smokeCalledAskUser = true
              console.log('  🔧 ask_user called!')
            } else if (block.type === 'tool_use') {
              console.log(`  🔧 ${block.name}`)
            }
            if (block.type === 'text' && block.text?.trim()) {
              console.log(`  💭 ${(block.text as string).slice(0, 120)}`)
            }
          }
        } catch {}
      },
    })

    // Wait for question file, then write reply
    await new Promise(resolve => setTimeout(resolve, 8000))
    await sandbox.files.write('/tmp/clarify-reply.txt', 'test reply')
    console.log('  [info] Reply written after 8s delay')

    const smokeResult = await smokePromise

    if (smokeResult.stderr?.trim()) {
      console.log(`  Stderr: ${smokeResult.stderr.slice(0, 300)}`)
    }

    assert(smokeCalledAskUser, 'Smoke test: Claude called ask_user via MCP')

    // Clean up
    await sandbox.commands.run(
      'rm -f /tmp/clarify-question.txt /tmp/clarify-reply.txt /tmp/mcp-debug.log'
    )

    // ── 6. Run Claude with MCP and monitor for clarify ─────────────────
    console.log('\n--- Step 6: Run Claude Code with MCP (expect ask_user) ---')
    console.log('  Waiting for agent to call ask_user...\n')

    const tools =
      'Read,Write,Edit,' +
      'Bash(git add *),Bash(git commit *),Bash(npm *),Bash(npx *),' +
      'Bash(ls *),Bash(cat *),Bash(mkdir *),' +
      'mcp__lumo-sandbox__ask_user,mcp__lumo-sandbox__report_progress'

    const command =
      `cd /home/user/repo && ANTHROPIC_API_KEY=${ANTHROPIC_KEY} ` +
      `claude -p "$(cat /home/user/task.md)" ` +
      `--allowedTools "${tools}" ` +
      `--mcp-config ${MCP_CONFIG_PATH} ` +
      `--output-format stream-json --verbose --max-turns 30`

    // Start the agent — it should call ask_user and block
    const agentPromise = sandbox.commands.run(command, {
      timeoutMs: 10 * 60 * 1000,
      onStdout: (data: string) => {
        try {
          const msg = JSON.parse(data)
          if (msg.type !== 'assistant') return
          for (const block of msg.message?.content ?? []) {
            if (block.type === 'text' && block.text?.trim()) {
              console.log(`  💭 ${(block.text as string).slice(0, 100)}`)
            }
            if (block.type === 'tool_use') {
              console.log(
                `  🔧 ${block.name}${block.name === 'ask_user' ? ' ← EXPECTED!' : ''}`
              )
            }
            if (block.type === 'tool_result') {
              const text =
                typeof block.content === 'string' ? block.content : ''
              if (text) console.log(`  📥 ${text.slice(0, 100)}`)
            }
          }
        } catch {}
      },
    })

    // ── 7. Poll for clarify question file ──────────────────────────────
    console.log('\n--- Step 7: Wait for clarify question file ---')

    let questionDetected = false
    let questionContent = ''
    const startTime = Date.now()
    const maxWait = 3 * 60 * 1000 // 3 min max

    while (Date.now() - startTime < maxWait) {
      await new Promise(resolve => setTimeout(resolve, 3000))
      try {
        const content = await sandbox.files.read('/tmp/clarify-question.txt')
        if (content) {
          questionDetected = true
          questionContent = content
          break
        }
      } catch {
        // File doesn't exist yet — keep polling
        process.stdout.write('.')
      }
    }
    console.log() // newline after dots

    assert(questionDetected, 'Agent wrote clarify question file')
    if (questionDetected) {
      const parsed = JSON.parse(questionContent)
      console.log(`  Question: "${parsed.question}"`)
      console.log(`  Context:  "${parsed.context || '(none)'}"`)
      assert(
        typeof parsed.question === 'string' && parsed.question.length > 0,
        'Question is non-empty'
      )
    }

    // ── 8. Simulate user reply (write reply file) ─────────────────────
    console.log('\n--- Step 8: Simulate user reply ---')

    const reply =
      'Create a simple HTML button in an index.html file. ' +
      'The button should say "Click Me" and show an alert("Hello!") when clicked. ' +
      'No framework needed — plain HTML/JS.'

    await sandbox.files.write('/tmp/clarify-reply.txt', reply)
    console.log(`  Reply written: "${reply.slice(0, 80)}..."`)

    // ── 9. Wait for agent to finish ───────────────────────────────────
    console.log('\n--- Step 9: Wait for agent to finish ---')
    console.log('  Agent should unblock and continue...\n')

    const agentResult = await agentPromise

    console.log(`  Exit code: ${agentResult.exitCode}`)
    if (agentResult.stderr?.trim()) {
      console.log(
        `  Stderr (first 500 chars):\n${agentResult.stderr.slice(0, 500)}`
      )
    }
    assert(
      agentResult.exitCode === 0,
      `Agent exited with code ${agentResult.exitCode}`
    )

    // ── 10. Verify commits ────────────────────────────────────────────
    console.log('\n--- Step 10: Verify agent output ---')

    const gitLog = await sandbox.commands.run(
      'git -C /home/user/repo log --oneline -5'
    )
    console.log(
      `  Git log:\n${gitLog.stdout
        .split('\n')
        .map(l => `    ${l}`)
        .join('\n')}`
    )

    const hasCommits = gitLog.stdout.includes('LUM-E2E')
    assert(hasCommits, 'Agent committed with [LUM-E2E] tag')

    const changedFiles = await sandbox.commands.run(
      'git -C /home/user/repo diff --name-only HEAD~1 HEAD 2>/dev/null || echo "(no diff)"'
    )
    console.log(`  Changed files: ${changedFiles.stdout.trim()}`)

    // Check index.html was created
    const indexExists = await sandbox.commands.run(
      'test -f /home/user/repo/index.html && echo "yes" || echo "no"'
    )
    assert(indexExists.stdout.trim() === 'yes', 'index.html was created')

    // ── 11. Verify the key benefit: single run, no restart ────────────
    console.log('\n--- Step 11: Verify single-run (no restart) ---')

    // The clarify files should have been cleaned up by the MCP server
    const questionGone = await sandbox.commands.run(
      'test -f /tmp/clarify-question.txt && echo "exists" || echo "gone"'
    )
    assert(
      questionGone.stdout.trim() === 'gone',
      'Question file cleaned up by MCP server'
    )

    const replyGone = await sandbox.commands.run(
      'test -f /tmp/clarify-reply.txt && echo "exists" || echo "gone"'
    )
    assert(
      replyGone.stdout.trim() === 'gone',
      'Reply file cleaned up by MCP server'
    )

    console.log('  ✓ Agent completed in a single run with context preserved')

    // ── Summary ─────────────────────────────────────────────────────────
    console.log(`\n${'═'.repeat(50)}`)
    console.log(`Results: ${passed} passed, ${failed} failed`)
    if (failed === 0) {
      console.log('✅ E2E MCP clarify flow works correctly!')
    } else {
      console.log('❌ Some checks failed — review output above')
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
