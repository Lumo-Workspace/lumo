import { Sandbox } from '@e2b/code-interpreter'

async function main() {
  console.log('Testing Clarify pause/resume flow...\n')

  const sandbox = await Sandbox.create({
    timeoutMs: 10 * 60 * 1000,
  })

  try {
    // 模拟 Agent 写入 Clarify 问题
    console.log('--- Simulating Agent writing clarify question ---')
    await sandbox.files.write(
      '/tmp/clarify-question.txt',
      JSON.stringify({
        question: 'Should the greet function support multiple languages?',
        context:
          'I was about to implement the greet function but the spec is unclear about i18n',
      })
    )
    console.log('✓ Question file written')

    // 模拟 Lumo 后端检测到问题
    console.log('\n--- Simulating Lumo detecting clarify request ---')
    const questionFile = await sandbox.files.read('/tmp/clarify-question.txt')
    const clarifyData = JSON.parse(questionFile)
    console.log('✓ Question detected:', clarifyData.question)
    console.log('  Context:', clarifyData.context)

    // 保存沙箱 ID（正式流程里存到数据库）
    const sandboxId = sandbox.sandboxId
    console.log('  Sandbox ID saved:', sandboxId)

    // 模拟用户 3 秒后回复
    console.log('\n--- Simulating user reply (after 3 seconds) ---')
    await new Promise(resolve => setTimeout(resolve, 3000))
    await sandbox.files.write(
      '/tmp/clarify-reply.txt',
      'No i18n needed. English only for now. Keep it simple.'
    )
    console.log('✓ Reply written')

    // 模拟 Agent 读取回复继续执行
    console.log('\n--- Simulating Agent reading reply and continuing ---')
    const replyContent = await sandbox.files.read('/tmp/clarify-reply.txt')
    console.log('✓ Agent read reply:', replyContent)

    // 清理文件
    await sandbox.commands.run(
      'rm /tmp/clarify-question.txt /tmp/clarify-reply.txt'
    )
    console.log('✓ Clarify files cleaned up')

    // 验证沙箱 reconnect
    console.log('\n--- Testing sandbox reconnect ---')
    console.log('Sandbox ID:', sandboxId)
    const reconnected = await Sandbox.connect(sandboxId)
    const testCmd = await reconnected.commands.run('echo "reconnect works"')
    console.log('✓ Reconnect successful:', testCmd.stdout.trim())

    console.log('\n✅ Clarify flow works correctly')
  } finally {
    await sandbox.kill()
  }
}

main().catch(console.error)
