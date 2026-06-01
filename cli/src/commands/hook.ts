import { runHook, type HookPath } from '../lib/hook-runner'
import { logHookError } from '../lib/hook-log'

/**
 * Dispatcher for the `lumo hook <path>` subcommands.
 *
 * Always exits 0. Failures are logged to `~/.lumo/hook.log` — never to
 * stderr. The inner try/catch is a belt-and-suspenders guard so that even
 * if `runHook` someday throws (it currently never does), Claude Code is
 * not disrupted.
 */
export async function hookCommand(
  path: HookPath,
  agentToken?: string
): Promise<void> {
  try {
    await runHook(path, agentToken)
  } catch (err) {
    logHookError(`[${path}] dispatcher`, err)
  }
}
