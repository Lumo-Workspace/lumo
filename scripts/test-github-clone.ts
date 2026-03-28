import { Sandbox } from '@e2b/code-interpreter'

const GITHUB_TOKEN = process.env.GITHUB_TOKEN!
const GITHUB_OWNER = process.env.GITHUB_OWNER!
const GITHUB_REPO = process.env.GITHUB_REPO!

if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
  console.error(
    'Missing required env vars: GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO'
  )
  process.exit(1)
}

async function main() {
  console.log('Creating sandbox...')
  const sandbox = await Sandbox.create({
    timeoutMs: 10 * 60 * 1000,
  })

  try {
    // 步骤1：验证 token 有效
    console.log('\n--- Step 1: Verify GitHub token ---')
    const whoami = await sandbox.commands.run(
      `curl -s -H "Authorization: token ${GITHUB_TOKEN}" https://api.github.com/user | grep '"login"'`
    )
    console.log('GitHub user:', whoami.stdout)

    // 步骤2：克隆仓库
    console.log('\n--- Step 2: Clone repository ---')
    const clone = await sandbox.commands.run(
      `git clone https://oauth2:${GITHUB_TOKEN}@github.com/${GITHUB_OWNER}/${GITHUB_REPO} /home/user/repo`,
      { timeoutMs: 2 * 60 * 1000 }
    )
    console.log('Clone stdout:', clone.stdout)
    console.log('Clone stderr:', clone.stderr)

    // 步骤3：配置 Git 身份
    console.log('\n--- Step 3: Configure Git identity ---')
    await sandbox.commands.run(
      'git -C /home/user/repo config user.email "agent@uselumo.ai" && git -C /home/user/repo config user.name "Lumo Agent"'
    )
    const gitConfig = await sandbox.commands.run(
      'git -C /home/user/repo config --list | grep user'
    )
    console.log('Git config:', gitConfig.stdout)

    // 步骤4：验证仓库结构
    console.log('\n--- Step 4: Verify repo structure ---')
    const ls = await sandbox.commands.run('ls /home/user/repo')
    console.log('Repo files:', ls.stdout)

    // 步骤5：创建新分支
    console.log('\n--- Step 5: Create branch ---')
    const branchName = 'lumo/LUM-1-test-agent'
    await sandbox.commands.run(
      `git -C /home/user/repo checkout -b ${branchName}`
    )
    const branch = await sandbox.commands.run(
      'git -C /home/user/repo branch --show-current'
    )
    console.log('Current branch:', branch.stdout)

    // 步骤6：写一个测试文件并提交
    console.log('\n--- Step 6: Test commit ---')
    await sandbox.files.write(
      '/home/user/repo/test-agent.txt',
      'This file was created by Lumo Agent test'
    )
    await sandbox.commands.run(
      'git -C /home/user/repo add test-agent.txt && git -C /home/user/repo commit -m "test: agent commit [LUM-1]"'
    )
    const log = await sandbox.commands.run(
      'git -C /home/user/repo log --oneline -3'
    )
    console.log('Git log:', log.stdout)

    // 步骤7：推送分支到 GitHub
    console.log('\n--- Step 7: Push branch ---')
    const push = await sandbox.commands.run(
      `git -C /home/user/repo push origin ${branchName}`,
      { timeoutMs: 60 * 1000 }
    )
    console.log('Push stdout:', push.stdout)
    console.log('Push stderr:', push.stderr)

    console.log(
      `\n✅ Branch pushed: https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/tree/${branchName}`
    )
  } finally {
    console.log('\nKilling sandbox...')
    await sandbox.kill()
    console.log('Done.')
  }
}

main().catch(console.error)
