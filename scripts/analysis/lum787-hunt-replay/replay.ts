/**
 * LUM-787 — replay the L3 hunt on ONE pull request's head sha, locally,
 * through the shipped pieces: the real planner output (a tasks file), the
 * real trigger over the real diff, a real Vercel sandbox holding the real
 * checkout, the real command gate / redactor / compressor / per-step
 * ledger, and the real `huntTask` loop against the real model. What it does
 * NOT go through is the workflow and the database — the batch's bookkeeping
 * closure from `securityHuntService.huntBatch` is re-created here (it is a
 * closure over a VM handle the workflow acquires with a production GitHub
 * App token this machine does not have; the clone credential here is the
 * operator's own `gh auth token`).
 *
 * Output is `huntAudit.tasks[]`-shaped, printed with the LUM-739 read-out and
 * written as JSON, so a run here reads exactly like a production row and can
 * be attached to the task as evidence.
 *
 * Run (needs AI_GATEWAY_API_KEY, a Vercel OIDC token — `vercel env pull` —
 * and a logged-in `gh`):
 *   VERCEL_OIDC_TOKEN=… DOTENV_CONFIG_PATH="$(pwd)/.env.local" npx tsx -r dotenv/config \
 *     scripts/analysis/lum787-hunt-replay/replay.ts --pr 1008 --sha <head sha> \
 *     [--repo Lumo-Workspace/lumo] [--tasks pr1008-tasks.json] [--out results.json] [--diff-file pr.diff]
 *
 * The tasks file is the planner's answer for that scan (copy it out of the
 * production `huntAudit.planned`); an objective of `null` means "the
 * deterministic fallback for this category", so a floor-forced task reads
 * what production would brief it with today.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  createRepoSandbox,
  denySandboxEgress,
  repoCheckoutDir,
} from '../../../lib/integrations/vercel-sandbox'
import {
  HUNT_SANDBOX_TAG,
  probeHuntTools,
  runHuntShell,
  scrubCloneCredentials,
  stopHuntSandbox,
  type HuntSandbox,
} from '../../../lib/services/security-hunt-sandbox'
import {
  SANDBOX_IMAGE,
  SANDBOX_TIMEOUT_WITH_HUNT_MS,
  SANDBOX_VCPUS,
} from '../../../lib/services/security-managed-scan.config'
import {
  HUNT_MAX_STEPS_PER_CATEGORY,
  HUNT_SHELL_LOG_CHARS,
  HUNT_SHELL_LOG_MAX,
  HUNT_TASK_TIME_MS,
  HUNT_TASK_TOKEN_MAX,
  HUNT_TRACE_MAX_STEPS,
  HUNT_TRACE_TEXT_CHARS,
  HUNT_WRAP_UP_MIN_MS,
  HUNT_WRAP_UP_TEXT_CHARS,
  HUNT_WRAP_UP_TIMEOUT_MS,
  type HuntCategory,
  type HuntCompressStats,
  type HuntShellStats,
  type HuntStepTrace,
  type HuntTask,
  type HuntTaskAudit,
  type HuntToolProbe,
} from '../../../lib/services/security-hunt.config'
import { huntTask } from '../../../lib/llm/security-hunt-client'
import { addedLinesWithNumbers } from '../../../lib/security-scan/diff-lines'
import {
  evaluateHuntTrigger,
  type HuntSignalSite,
} from '../../../lib/security-scan/hunt/trigger'
import { categoriesToTasks } from '../../../lib/security-scan/hunt/plan-fallback'
import {
  admitStepOutput,
  newStepLedger,
} from '../../../lib/security-scan/hunt/step-output'
import { redactKnownSecrets } from '../../../lib/security-scan'
import { formatShellDetail } from '../lum739-hunt-audit/aggregate'

interface Args {
  pr: number
  sha: string
  repo: string
  tasks: string
  out: string
  diffFile?: string
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const pr = Number(get('--pr'))
  const sha = get('--sha')
  if (!Number.isInteger(pr) || !sha) {
    throw new Error(
      'usage: --pr <number> --sha <head sha> [--repo o/r] [--tasks f] [--out f] [--diff-file f]'
    )
  }
  const here = path.dirname(new URL(import.meta.url).pathname)
  return {
    pr,
    sha,
    repo: get('--repo') ?? 'Lumo-Workspace/lumo',
    tasks: get('--tasks') ?? path.join(here, `pr${pr}-tasks.json`),
    out: get('--out') ?? path.join(here, `results-pr${pr}.json`),
    ...(get('--diff-file') ? { diffFile: get('--diff-file') } : {}),
  }
}

/** The planner's answer, with `null` objectives filled from the fallback. */
function loadTasks(file: string): HuntTask[] {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Array<{
    id: string
    category: HuntCategory
    objective: string | null
    startingPoints: string[]
  }>
  return raw.map(t => ({
    id: t.id,
    category: t.category,
    objective: t.objective ?? categoriesToTasks([t.category])[0]!.objective,
    startingPoints: t.startingPoints,
  }))
}

/** The bookkeeping closure of `huntBatch`, re-created for one task. */
async function runTask(
  handle: HuntSandbox,
  tools: HuntToolProbe,
  task: HuntTask,
  reasons: string[],
  sites: HuntSignalSite[]
): Promise<HuntTaskAudit & { submitted: unknown[] }> {
  const started = Date.now()
  const shell: HuntShellStats = {
    calls: 0,
    refused: 0,
    failed: 0,
    notFound: 0,
    empty: 0,
    outputChars: 0,
    commands: [],
  }
  const compress: HuntCompressStats = {
    calls: 0,
    noOpCalls: 0,
    inputChars: 0,
    outputChars: 0,
    tokens: 0,
  }
  const trace: HuntStepTrace[] = []
  let ledger = newStepLedger()
  const onStep = (step: HuntStepTrace): void => {
    ledger = newStepLedger()
    if (trace.length >= HUNT_TRACE_MAX_STEPS) return
    trace.push({
      ...step,
      ...(step.text
        ? {
            text: redactKnownSecrets(step.text).slice(0, HUNT_TRACE_TEXT_CHARS),
          }
        : {}),
    })
    process.stderr.write(
      `  [${task.id}] step ${step.i} tool=${step.tool ?? '-'} in=${step.inputTokens ?? '?'} out=${step.outputTokens ?? '?'}${step.elidedChars ? ` elided=${step.elidedChars}` : ''}\n`
    )
  }
  const reserveMs = Math.min(
    HUNT_WRAP_UP_TIMEOUT_MS,
    Math.floor(HUNT_TASK_TIME_MS / 3)
  )
  const searchMs =
    HUNT_TASK_TIME_MS - (reserveMs >= HUNT_WRAP_UP_MIN_MS ? reserveMs : 0)
  const base = {
    taskId: task.id,
    objective: task.objective,
    category: task.category,
  }
  try {
    const out = await huntTask({
      task,
      reasons,
      sites,
      tools,
      runShell: async command => {
        shell.calls += 1
        const entryIndex = shell.commands.length
        if (entryIndex < HUNT_SHELL_LOG_MAX) {
          shell.commands.push({
            cmd: redactKnownSecrets(command).slice(0, HUNT_SHELL_LOG_CHARS),
          })
        }
        const res = await runHuntShell({ handle, task, command })
        const admitted = admitStepOutput(ledger, res.output)
        if (admitted.clipped) shell.stepClipped = (shell.stepClipped ?? 0) + 1
        if (entryIndex < HUNT_SHELL_LOG_MAX) {
          const entry = shell.commands[entryIndex]!
          if (res.denied) {
            entry.denied = true
            if (res.error !== undefined) {
              entry.reason = redactKnownSecrets(res.error).slice(
                0,
                HUNT_SHELL_LOG_CHARS
              )
            }
          }
          entry.chars = admitted.output.length
          if (res.compressed) entry.compressed = true
          if (admitted.clipped) entry.clipped = true
          if (res.exitCode !== undefined) entry.exit = res.exitCode
          if (res.commandNotFound) entry.notFound = true
        }
        compress.tokens += res.compressTokens
        if (res.compressed) {
          compress.calls += 1
          compress.inputChars += res.compressInputChars
          compress.outputChars += res.compressOutputChars
        }
        if (res.compressNoOp) compress.noOpCalls += 1
        if (res.denied) shell.refused += 1
        else if (res.error !== undefined) shell.failed += 1
        else if (res.commandNotFound) shell.notFound += 1
        else if (res.output.trim().length === 0) shell.empty += 1
        shell.outputChars += admitted.output.length
        process.stderr.write(
          `  [${task.id}] $ ${command.slice(0, 100)}  → ${admitted.output.length} chars${admitted.clipped ? ' (clipped)' : ''}${res.denied ? ' REFUSED' : ''}\n`
        )
        const { error } = res
        const output = admitted.output
        return error === undefined ? { output } : { output, error }
      },
      tokenBudget: HUNT_TASK_TOKEN_MAX,
      timeoutMs: searchMs,
      maxSteps: HUNT_MAX_STEPS_PER_CATEGORY,
      wrapUpDeadlineAt: started + HUNT_TASK_TIME_MS,
      onStep,
    })
    return {
      ...base,
      candidates: out.candidates.length,
      tokens: out.tokens + compress.tokens,
      elapsedMs: Date.now() - started,
      stopped: out.stopped,
      ...(out.wrappedUp ? { wrappedUp: true } : {}),
      ...(out.wrapUpWarnings ? { wrapUpWarnings: out.wrapUpWarnings } : {}),
      shell,
      trace,
      stop: out.stop,
      wrapUp: {
        ...out.wrapUp,
        ...(out.wrapUp.text
          ? {
              text: redactKnownSecrets(out.wrapUp.text).slice(
                0,
                HUNT_WRAP_UP_TEXT_CHARS
              ),
            }
          : {}),
      },
      submitted: out.candidates,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ...base,
      candidates: 0,
      tokens: compress.tokens,
      elapsedMs: Date.now() - started,
      stopped: /abort/i.test(message) ? 'timeout' : 'error',
      shell,
      trace,
      submitted: [],
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const diff = args.diffFile
    ? readFileSync(args.diffFile, 'utf8')
    : execFileSync('gh', ['pr', 'diff', String(args.pr), '--repo', args.repo], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      })
  const files = addedLinesWithNumbers(diff)
  const trigger = evaluateHuntTrigger({
    files,
    hasHighFinding: false,
    hasOpenL4Crossing: false,
  })
  const tasks = loadTasks(args.tasks)
  console.log(
    `=== LUM-787 hunt replay · PR #${args.pr} @ ${args.sha.slice(0, 8)} ===`
  )
  console.log(
    `diff: ${files.length} files with added lines · trigger.hunt=${trigger.hunt} · reasons: ${trigger.reasons.join(', ') || '(none)'} · sites: ${trigger.sites.length}`
  )
  console.log(`tasks: ${tasks.map(t => `${t.id}:${t.category}`).join(' · ')}`)

  const token = execFileSync('gh', ['auth', 'token'], {
    encoding: 'utf8',
  }).trim()
  const bootedAt = Date.now()
  const sandbox = await createRepoSandbox({
    repository: args.repo,
    revision: args.sha,
    token,
    timeoutMs: SANDBOX_TIMEOUT_WITH_HUNT_MS,
    vcpus: SANDBOX_VCPUS,
    image: SANDBOX_IMAGE,
    tags: { [HUNT_SANDBOX_TAG]: `replay-pr${args.pr}` },
  })
  let egressDenied = false
  try {
    await denySandboxEgress(sandbox.name)
    egressDenied = true
  } catch (error) {
    console.log(
      `egress lockdown failed: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  const handle: HuntSandbox = {
    sandbox,
    cwd: repoCheckoutDir(sandbox.cwd, args.repo),
    token,
    origin: 'created',
    egressDenied,
  }
  const results: Array<HuntTaskAudit & { submitted: unknown[] }> = []
  try {
    await scrubCloneCredentials(handle, args.repo)
    const tools = await probeHuntTools(handle)
    console.log(
      `sandbox ${sandbox.name} ready in ${Date.now() - bootedAt}ms · egressDenied=${egressDenied} · tools present: ${tools.present.join(', ')}${tools.missing.length ? ` · missing: ${tools.missing.join(', ')}` : ''}`
    )
    for (const task of tasks) {
      console.log(`\n--- ${task.id} (${task.category}) ---`)
      results.push(
        await runTask(handle, tools, task, trigger.reasons, trigger.sites)
      )
    }
  } finally {
    await stopHuntSandbox(handle)
  }

  console.log('\n=== read-out (LUM-739 formatShellDetail) ===')
  for (const line of formatShellDetail(results, results.length))
    console.log(line)

  console.log('\n=== LUM-787 acceptance ===')
  const done = results.filter(r => r.stopped === 'done').length
  const minSteps = Math.min(...results.map(r => r.stop?.steps ?? 0))
  const refused = results.reduce((n, r) => n + (r.shell?.refused ?? 0), 0)
  const clipped = results.reduce((n, r) => n + (r.shell?.stepClipped ?? 0), 0)
  const wrapUps = results.filter(r => r.wrapUp?.ran).length
  for (const r of results) {
    console.log(
      `${r.taskId} ${r.category}: ${r.stopped} · ${r.stop?.steps ?? '?'} steps · ${r.tokens} tokens · refused ${r.shell?.refused ?? 0} · step-clipped ${r.shell?.stepClipped ?? 0} · candidates ${r.candidates}${r.wrapUp?.ran ? ` · wrap-up submitted ${r.wrapUp.submitted ?? 0}` : r.wrapUp?.skipped ? ` · wrap-up skipped (${r.wrapUp.skipped})` : ''}`
    )
  }
  const pass = done >= 2 && minSteps >= 4 && refused === 0
  console.log(
    `done ${done}/${results.length} (need ≥2) · min steps ${minSteps} (need ≥4) · gate refused ${refused} (need 0) · step-clipped ${clipped} · wrap-ups ran ${wrapUps} → ${pass ? 'PASS' : 'FAIL'}`
  )

  writeFileSync(
    args.out,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        pr: args.pr,
        sha: args.sha,
        repo: args.repo,
        trigger: { reasons: trigger.reasons, sites: trigger.sites },
        sandbox: { name: sandbox.name, egressDenied },
        tasks: results,
        acceptance: { done, minSteps, refused, clipped, pass },
      },
      null,
      2
    )
  )
  console.log(`\nwrote ${args.out}`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
