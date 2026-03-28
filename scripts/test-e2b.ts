import { Sandbox } from '@e2b/code-interpreter'

async function main() {
  console.log('Creating sandbox...')
  const sandbox = await Sandbox.create({
    timeoutMs: 5 * 60 * 1000,
  })
  console.log('Sandbox ID:', sandbox.sandboxId)

  // 测试1：基础命令
  console.log('\n--- Test 1: Basic command ---')
  const result1 = await sandbox.commands.run('echo "sandbox works"')
  console.log('Output:', result1.stdout)

  // 测试2：文件写入和读取
  console.log('\n--- Test 2: File operations ---')
  await sandbox.files.write('/tmp/test.txt', 'hello from lumo')
  const content = await sandbox.files.read('/tmp/test.txt')
  console.log('File content:', content)

  // 测试3：Node.js 可用
  console.log('\n--- Test 3: Node.js ---')
  const result3 = await sandbox.commands.run('node --version')
  console.log('Node version:', result3.stdout)

  // 测试4：Git 可用
  console.log('\n--- Test 4: Git ---')
  const result4 = await sandbox.commands.run('git --version')
  console.log('Git version:', result4.stdout)

  // 销毁沙箱
  console.log('\nKilling sandbox...')
  await sandbox.kill()
  console.log('Done.')
}

main().catch(console.error)
