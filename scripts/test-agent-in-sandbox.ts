import { Sandbox } from '@e2b/code-interpreter'

async function main() {
  console.log('Creating sandbox...')
  const sandbox = await Sandbox.create({
    timeoutMs: 10 * 60 * 1000,
  })

  try {
    // 步骤1：确认 Node.js 版本（Claude SDK 需要 Node 18+）
    console.log('\n--- Step 1: Check Node.js version ---')
    const nodeVersion = await sandbox.commands.run('node --version')
    console.log('Node:', nodeVersion.stdout)

    // 步骤2：安装 Claude Agent SDK
    console.log('\n--- Step 2: Install Claude Agent SDK ---')
    const install = await sandbox.commands.run(
      'sudo npm install -g @anthropic-ai/claude-code',
      { timeoutMs: 3 * 60 * 1000 }
    )
    console.log('Install stdout:', install.stdout)
    console.log('Install stderr:', install.stderr)

    // 步骤3：验证 claude 命令可用
    console.log('\n--- Step 3: Verify claude command ---')
    const version = await sandbox.commands.run('claude --version')
    console.log('Claude version:', version.stdout)

    // 步骤4：写一个简单文件让 Agent 读取
    console.log('\n--- Step 4: Write test file ---')
    await sandbox.files.write('/home/user/hello.txt', 'Hello from Lumo!')

    // 步骤5：在沙箱内运行 Claude Agent SDK 执行简单任务
    console.log('\n--- Step 5: Run Claude Agent in sandbox ---')
    const agentResult = await sandbox.commands.run(
      `ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY} claude -p "Read the file at /home/user/hello.txt and tell me what it says." --allowedTools "Read" --output-format json --bare --max-turns 3`,
      { timeoutMs: 2 * 60 * 1000 }
    )
    console.log('Agent stdout:', agentResult.stdout)
    console.log('Agent stderr:', agentResult.stderr)

    // 步骤6：解析 JSON 输出
    console.log('\n--- Step 6: Parse result ---')
    const lines = agentResult.stdout.trim().split('\n')
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line)
        if (parsed.type === 'result') {
          console.log('Agent result:', parsed.result)
        }
      } catch {
        // 不是 JSON 行，跳过
      }
    }
  } finally {
    console.log('\nKilling sandbox...')
    await sandbox.kill()
    console.log('Done.')
  }
}

main().catch(console.error)
