import { Prisma } from '@prisma/client'
import { Sandbox } from '@e2b/code-interpreter'
import { prisma } from '@/lib/db/prisma'
import { pushAgentEvent, fireAgentEvent } from '@/lib/integrations/pusher'
import { buildAgentContext } from './context-builder'
import { MCP_CONFIG_PATH } from '@/lib/integrations/sandbox'
import type { RunContext } from './execute'

// ── Constants ──────────────────────────────────────────────────────────────

const AGENT_TIMEOUT_MS = 30 * 60 * 1000

const CLAUDE_ALLOWED_TOOLS =
  'Read,Write,Edit,' +
  'Bash(git add *),Bash(git commit *),Bash(git push *),Bash(npm *),Bash(npx *),' +
  'Bash(ls *),Bash(cat *),Bash(mkdir *),' +
  'mcp__lumo-sandbox__ask_user,mcp__lumo-sandbox__report_progress'

// ── Pipeline stages ──────────────────────────────────────────────────────

/** Known pipeline stages — order matters. */
const PIPELINE_STAGES = [
  { key: 'clone', label: 'Clone repository' },
  { key: 'setup', label: 'Set up environment' },
  { key: 'branch', label: 'Prepare branch' },
  { key: 'analyze', label: 'Analyze codebase' },
  { key: 'verify', label: 'Verify changes' },
  { key: 'metadata', label: 'Collect run metadata' },
  { key: 'pr', label: 'Create pull request' },
] as const

export type StageKey = (typeof PIPELINE_STAGES)[number]['key']

export interface PipelineStep {
  key: string
  text: string
  elapsedMs: number
  status: 'pending' | 'done'
}

/** Build the initial steps array with all stages as pending. */
export function buildInitialSteps(): PipelineStep[] {
  return PIPELINE_STAGES.map(s => ({
    key: s.key,
    text: s.label,
    elapsedMs: 0,
    status: 'pending' as const,
  }))
}

/** Mark a pipeline step as done (by key) in the DB. */
export function markStepDone(
  runId: string,
  key: StageKey,
  text: string,
  elapsedMs: number
): void {
  // Read-modify-write: safe because there's only one writer per run
  prisma.agentRun
    .findUnique({ where: { id: runId }, select: { steps: true } })
    .then(run => {
      if (!run?.steps || !Array.isArray(run.steps)) return
      const updated = (run.steps as unknown as PipelineStep[]).map(s =>
        s.key === key ? { ...s, status: 'done' as const, text, elapsedMs } : s
      )
      return prisma.agentRun.update({
        where: { id: runId },
        data: { steps: updated as unknown as Prisma.InputJsonValue },
      })
    })
    .catch(err => console.error('[Agent] Failed to update step:', err))
}

/** Tracks the timestamp of the last completed step per run. */
export const runStepTimers = new Map<string, number>()

/**
 * Fire a progress Pusher event AND mark the pipeline step as done in DB.
 * Elapsed time is automatically computed from the previous step's completion.
 */
export function fireProgress(
  taskId: string,
  runId: string,
  key: StageKey,
  message: string
): void {
  const now = Date.now()
  const lastTime = runStepTimers.get(runId) ?? now
  const elapsedMs = now - lastTime
  runStepTimers.set(runId, now)

  fireAgentEvent(taskId, { type: 'agent:progress', message, key })
  markStepDone(runId, key, message, elapsedMs)
}

// ── Task spec ─────────────────────────────────────────────────────────────

export async function writeTaskSpec(sandbox: Sandbox, ctx: RunContext) {
  const content = await buildAgentContext({
    taskId: ctx.taskId,
    branchName: ctx.branchName,
    identifier: ctx.identifier,
  })
  await sandbox.files.write('/home/user/task.md', content)
}

// ── Agent script ─────────────────────────────────────────────────────────

/**
 * Write the agent runner script and completion callback to the sandbox.
 * The runner executes Claude CLI with a timeout, then calls our webhook
 * with the exit code so we can do post-processing from a fresh function.
 */
export async function writeAgentScript(
  sandbox: Sandbox,
  ctx: RunContext,
  branchExistsOnRemote: boolean
): Promise<void> {
  const callbackUrl = process.env.NEXT_PUBLIC_APP_URL
  const timeoutSecs = Math.floor(AGENT_TIMEOUT_MS / 1000)

  const runScript = `#!/bin/bash
cd /home/user/repo
export ANTHROPIC_API_KEY="${ctx.anthropicKey}"

timeout --signal=TERM ${timeoutSecs} \\
  claude -p "$(cat /home/user/task.md)" \\
  --allowedTools "${CLAUDE_ALLOWED_TOOLS}" \\
  --mcp-config ${MCP_CONFIG_PATH} \\
  --output-format stream-json --verbose --max-turns 50 \\
  > /tmp/agent-stdout.log 2>/tmp/agent-stderr.log

EXIT_CODE=$?
python3 /home/user/send-callback.py $EXIT_CODE
`

  const callbackPy = `import json, sys, urllib.request

exit_code = int(sys.argv[1])

stderr = ""
try:
    with open("/tmp/agent-stderr.log") as f:
        content = f.read()
        stderr = content[-500:] if content else ""
except:
    pass

payload = json.dumps({
    "runId": ${JSON.stringify(ctx.currentRunId)},
    "taskId": ${JSON.stringify(ctx.taskId)},
    "exitCode": exit_code,
    "timedOut": exit_code == 124,
    "stderr": stderr,
    "branchExistsOnRemote": ${JSON.stringify(branchExistsOnRemote)},
})

req = urllib.request.Request(
    ${JSON.stringify(`${callbackUrl}/api/agent/sandbox-done`)},
    data=payload.encode(),
    headers={
        "Content-Type": "application/json",
        "Authorization": ${JSON.stringify(`Bearer ${ctx.mcpToken}`)},
    },
    method="POST",
)

# Retry up to 3 times with backoff
import time
for attempt in range(3):
    try:
        urllib.request.urlopen(req, timeout=30)
        print(f"Callback sent successfully (attempt {attempt + 1})")
        break
    except Exception as e:
        print(f"Callback attempt {attempt + 1} failed: {e}", file=sys.stderr)
        if attempt < 2:
            time.sleep(2 ** attempt)
`

  await sandbox.files.write('/home/user/run-agent.sh', runScript)
  await sandbox.files.write('/home/user/send-callback.py', callbackPy)
}

// ── Clarify finalization ─────────────────────────────────────────────────

export async function finalizeClarify(
  taskId: string,
  runId: string
): Promise<{ outcome: 'clarify'; question: string }> {
  await prisma.agentClarify.updateMany({
    where: { taskId, agentRunId: null },
    data: { agentRunId: runId },
  })
  const clarify = await prisma.agentClarify.findFirst({
    where: { taskId },
    orderBy: { createdAt: 'desc' },
  })
  await pushAgentEvent(taskId, {
    type: 'agent:clarify',
    question: clarify?.question ?? '',
    context: clarify?.context ?? null,
  })
  return { outcome: 'clarify', question: clarify?.question ?? '' }
}
