import { Sandbox } from '@e2b/code-interpreter'

const GITHUB_TOKEN = process.env.GITHUB_TOKEN!
const GITHUB_OWNER = process.env.GITHUB_OWNER!
const GITHUB_REPO = process.env.GITHUB_REPO!

async function main() {
  console.log('Creating sandbox...')
  const sandbox = await Sandbox.create({
    timeoutMs: 10 * 60 * 1000,
  })

  try {
    // 步骤1：克隆仓库 + 配置 Git
    console.log('\n--- Step 1: Clone repo ---')
    await sandbox.commands.run(
      `git clone https://oauth2:${GITHUB_TOKEN}@github.com/${GITHUB_OWNER}/${GITHUB_REPO} /home/user/repo && git -C /home/user/repo config user.email "agent@uselumo.ai" && git -C /home/user/repo config user.name "Lumo Agent"`,
      { timeoutMs: 2 * 60 * 1000 }
    )
    console.log('Cloned.')

    // 步骤2：验证 CLAUDE.md 存在
    console.log('\n--- Step 2: Verify CLAUDE.md exists ---')
    const claudeMd = await sandbox.commands.run('cat /home/user/repo/CLAUDE.md')
    console.log('CLAUDE.md preview:', claudeMd.stdout.slice(0, 200) + '...')

    // 步骤3：安装 Claude Agent SDK
    console.log('\n--- Step 3: Install Claude Agent SDK ---')
    await sandbox.commands.run(
      'sudo npm install -g @anthropic-ai/claude-code',
      {
        timeoutMs: 3 * 60 * 1000,
      }
    )
    console.log('Installed.')

    // 步骤4：让 Agent 读取 CLAUDE.md 并回答约定问题
    console.log('\n--- Step 4: Ask Agent about conventions ---')
    const askResult = await sandbox.commands.run(
      `cd /home/user/repo && ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY} claude -p "Read CLAUDE.md and answer: 1. What branch naming convention should you use? 2. What test framework should you use? 3. What files are you forbidden to modify? Answer in bullet points." --allowedTools "Read" --output-format json --bare --max-turns 3`,
      { timeoutMs: 2 * 60 * 1000 }
    )
    for (const line of askResult.stdout.trim().split('\n')) {
      try {
        const parsed = JSON.parse(line)
        if (parsed.type === 'result') {
          console.log('\nAgent understands CLAUDE.md:')
          console.log(parsed.result)
        }
      } catch {}
    }

    // 步骤5：让 Agent 执行任务，验证它遵守约定
    console.log('\n--- Step 5: Test convention compliance ---')
    await sandbox.commands.run(
      `cd /home/user/repo && ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY} claude -p "Create a new branch for task LUM-99 called 'test claude md'. Follow the branch naming convention in CLAUDE.md exactly. Then create a file test-claude-md.txt with content 'CLAUDE.md works'. Commit it following the commit message convention in CLAUDE.md." --allowedTools "Read,Bash(git *),Write" --output-format json --bare --max-turns 10`,
      { timeoutMs: 3 * 60 * 1000 }
    )

    // 验证分支名
    const branch = await sandbox.commands.run(
      'git -C /home/user/repo branch --show-current'
    )
    console.log('\nBranch created:', branch.stdout.trim())

    // 验证 commit message
    const log = await sandbox.commands.run(
      'git -C /home/user/repo log --oneline -1'
    )
    console.log('Commit message:', log.stdout.trim())

    // 检查是否符合约定
    const branchName = branch.stdout.trim()
    const commitMsg = log.stdout.trim()
    console.log('\n--- Validation ---')
    console.log(
      'Branch follows convention (lumo/LUM-*):',
      branchName.startsWith('lumo/LUM-') ? '✅' : '❌'
    )
    console.log(
      'Commit includes task ID ([LUM-*):',
      commitMsg.includes('[LUM-') ? '✅' : '❌'
    )
  } finally {
    console.log('\nKilling sandbox...')
    await sandbox.kill()
    console.log('Done.')
  }
}

main().catch(console.error)
