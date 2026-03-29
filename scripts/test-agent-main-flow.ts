import { Sandbox } from '@e2b/code-interpreter'
import {
  slugify,
  createPullRequest,
  updateTask,
  createNotification,
} from '../lib/agent/utils'

const GITHUB_TOKEN = process.env.GITHUB_TOKEN!
const GITHUB_OWNER = process.env.GITHUB_OWNER!
const GITHUB_REPO = process.env.GITHUB_REPO!

const testTask = {
  id: 'test-task-001',
  identifier: 'LUM-99',
  title: 'Add a hello world utility function',
  spec: `
## Requirements
Create a utility function called greet(name: string): string
- Located in src/utils/greet.ts
- Returns "Hello, {name}!"
- If name is empty, returns "Hello, World!"

## Tests
Write tests in __tests__/greet.test.ts
Cover:
- Normal case: greet("Lumo") returns "Hello, Lumo!"
- Empty case: greet("") returns "Hello, World!"

## Acceptance criteria
- TypeScript strict mode
- All tests pass
  `.trim(),
  repoOwner: GITHUB_OWNER,
  repoName: GITHUB_REPO,
  repo: `${GITHUB_OWNER}/${GITHUB_REPO}`,
  reviewerId: 'reviewer-001',
  workspaceId: 'workspace-001',
}

async function executeAgent(task: typeof testTask, githubToken: string) {
  console.log(`\n🚀 Starting agent for task ${task.identifier}: ${task.title}`)

  const sandbox = await Sandbox.create({ timeoutMs: 30 * 60 * 1000 })
  console.log('✓ Sandbox created:', sandbox.sandboxId)

  try {
    // ── 1. 更新任务状态 ──────────────────────────────
    await updateTask(task.id, { agentStatus: 'RUNNING' })
    console.log('✓ Task status: running')

    // ── 2. 克隆仓库 ──────────────────────────────────
    console.log('\n📦 Cloning repository...')
    await sandbox.commands.run(
      `git clone https://oauth2:${githubToken}@github.com/${task.repo} /home/user/repo && git -C /home/user/repo config user.email "agent@uselumo.ai" && git -C /home/user/repo config user.name "Lumo Agent"`,
      { timeoutMs: 2 * 60 * 1000 }
    )
    console.log('✓ Cloned')

    // ── 3. 安装 Claude Agent SDK ─────────────────────
    console.log('\n📦 Installing Claude Agent SDK...')
    await sandbox.commands.run(
      'sudo npm install -g @anthropic-ai/claude-code',
      {
        timeoutMs: 3 * 60 * 1000,
      }
    )
    console.log('✓ Installed')

    // ── 4. 创建分支 ──────────────────────────────────
    const branchName = `lumo/${task.identifier}-${slugify(task.title)}`
    console.log(`\n🌿 Creating branch: ${branchName}`)
    await sandbox.commands.run(
      `git -C /home/user/repo checkout -b ${branchName}`
    )
    console.log('✓ Branch created')

    // ── 5. 写入任务 Spec ──────────────────────────────
    await sandbox.files.write(
      '/home/user/task.md',
      `# Task: ${task.title}
Task ID: ${task.identifier}

${task.spec}

## Instructions
- Read CLAUDE.md first for project conventions
- Branch is already created: ${branchName}
- Commit your changes when done; include [${task.identifier}] in the commit message
- Do NOT push; do NOT create a PR (handled automatically)
`.trim()
    )
    console.log('✓ Task spec written')

    // ── 6. 运行 Claude Agent SDK ──────────────────────
    console.log('\n🤖 Running Claude Agent...')
    console.log('   This may take several minutes...\n')

    const agentResult = await sandbox.commands.run(
      `cd /home/user/repo && ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY} claude -p "$(cat /home/user/task.md)" --allowedTools "Read,Write,Edit,Bash(git add *),Bash(git commit *),Bash(npm *),Bash(npx *),Bash(ls *),Bash(cat *),Bash(mkdir *)" --output-format stream-json --verbose --bare --max-turns 50`,
      {
        timeoutMs: 25 * 60 * 1000,
        onStdout: (data: string) => {
          try {
            const msg = JSON.parse(data)
            if (msg.type === 'assistant') {
              msg.message?.content?.forEach(
                (block: { type: string; text?: string; name?: string }) => {
                  if (block.type === 'text' && block.text)
                    console.log('   Agent:', block.text.slice(0, 120))
                  if (block.type === 'tool_use')
                    console.log(`   Tool:  ${block.name}`)
                }
              )
            }
          } catch {}
        },
      }
    )

    console.log('\n✓ Agent finished')
    if (agentResult.exitCode !== 0) {
      throw new Error(
        `Agent failed (exit ${agentResult.exitCode}): ${agentResult.stderr}`
      )
    }

    // ── 7. 验证 Agent 产出 ────────────────────────────
    console.log('\n🔍 Verifying agent output...')

    const gitLog = await sandbox.commands.run(
      'git -C /home/user/repo log --oneline -5'
    )
    console.log('Git log:\n', gitLog.stdout)

    const newFiles = await sandbox.commands.run(
      'git -C /home/user/repo diff --name-only HEAD~1 HEAD 2>/dev/null || git -C /home/user/repo diff --name-only HEAD'
    )
    console.log('Changed files:', newFiles.stdout)

    // ── 8. 推送分支 ───────────────────────────────────
    console.log('\n📤 Pushing branch...')
    const push = await sandbox.commands.run(
      `git -C /home/user/repo push origin ${branchName}`,
      { timeoutMs: 60 * 1000 }
    )
    if (push.exitCode !== 0) {
      throw new Error(`Push failed: ${push.stderr}`)
    }
    console.log('✓ Branch pushed')

    // ── 9. 创建 PR ────────────────────────────────────
    console.log('\n🔀 Creating Pull Request...')
    const pr = await createPullRequest({
      owner: task.repoOwner,
      repo: task.repoName,
      branch: branchName,
      title: `${task.title} [${task.identifier}]`,
      body: `## Summary\n\n${task.spec}\n\n---\n_This PR was created by Lumo Agent_\n\nRelated task: ${task.identifier}`,
      token: githubToken,
    })
    console.log('✓ PR created:', pr.html_url)

    // ── 10. 更新任务状态 ──────────────────────────────
    await updateTask(task.id, { agentStatus: 'DONE', status: 'IN_REVIEW' })
    await createNotification(task.reviewerId, 'TASK_IN_REVIEW', task.id)
    console.log('✓ Task status: IN_REVIEW, reviewer notified')

    console.log(`\n✅ Done! PR: ${pr.html_url}`)
    return pr
  } catch (error) {
    console.error('\n❌ Agent failed:', error)
    await updateTask(task.id, { agentStatus: 'FAILED' })
    await createNotification(task.reviewerId, 'AGENT_FAILED', task.id)
    throw error
  } finally {
    console.log('\nKilling sandbox...')
    await sandbox.kill()
  }
}

executeAgent(testTask, GITHUB_TOKEN).catch(console.error)
