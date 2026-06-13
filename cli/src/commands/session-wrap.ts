import { readCredentials } from '../lib/config'
import { runWrapPanel } from '../lib/wrap-panel'
import { MemoryReviewSection } from './wrap/memory-review-section'
import { FragmentUsageSection } from './wrap/fragment-usage-section'
import { BlockedPromptSection } from './wrap/blocked-prompt-section'
import { openCrossingReminder } from './wrap/crossings-reminder'

interface SessionWrapOptions {
  yes?: boolean
  dryRun?: boolean
  /** Indices (1-based, comma/space separated) of injected fragments the agent
   *  actually used; "none" records all-unused. Undefined = don't record. */
  used?: string
}

/**
 * `lumo session wrap [--yes] [--dry-run]`
 *
 * Session-end wrap-up panel with three sections, run in order: (1) review the
 * Layer1 memories this session sedimented — keep/delete/promote, deduped by a
 * per-session watermark; (2) vote which injected context fragments were
 * actually used (LUM-300, via `--used`); (3) if the session repeatedly hit the
 * same failure, prompt whether to flag the bound task with a `blocked` tag
 * (LUM-153).
 */
export async function sessionWrap(
  options: SessionWrapOptions
): Promise<number | void> {
  const sessionId = process.env.CLAUDE_CODE_SESSION_ID
  if (!sessionId) {
    console.error(
      'Error: $CLAUDE_CODE_SESSION_ID is not set.\n' +
        '`lumo session wrap` must be run inside a Claude Code session.'
    )
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }

  const sections = [
    new MemoryReviewSection({ creds, sessionId }),
    new FragmentUsageSection({ creds, sessionId, used: options.used }),
    new BlockedPromptSection({ creds, sessionId }),
  ]
  await runWrapPanel(sections, {
    yes: options.yes === true,
    dryRun: options.dryRun === true,
  })

  // After the panel: a read-only nudge if the bound task has open boundary
  // crossings still undispositioned (LUM-448). Silent when there are none —
  // a clean task adds no wrap-up noise. Awareness only; clearing a crossing is
  // web + human-only (LUM-426/435/422).
  const reminder = await openCrossingReminder(creds)
  if (reminder) process.stdout.write(reminder)
}
