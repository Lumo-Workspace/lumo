import { readCredentials } from '../lib/config'
import { runWrapPanel } from '../lib/wrap-panel'
import { ProgressCommentSection } from './wrap/progress-comment-section'
import { MemoryReviewSection } from './wrap/memory-review-section'
import { BlockedPromptSection } from './wrap/blocked-prompt-section'

interface SessionWrapOptions {
  yes?: boolean
  dryRun?: boolean
}

/**
 * `lumo session wrap [--yes] [--dry-run]`
 *
 * Session-end wrap-up panel with three sections, run in order: (1) draft a
 * progress comment from this session's unposted turnSummaries and post it
 * (after y/e/s confirmation) to the bound task; (2) review the Layer1 memories
 * this session sedimented — keep/delete/promote, deduped by a per-session
 * watermark; (3) if the session repeatedly hit the same failure, prompt whether
 * to flag the bound task with a `blocked` tag (LUM-153, prompt-only).
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
    new ProgressCommentSection({ creds, sessionId }),
    new MemoryReviewSection({ creds, sessionId }),
    new BlockedPromptSection({ creds, sessionId }),
  ]
  await runWrapPanel(sections, {
    yes: options.yes === true,
    dryRun: options.dryRun === true,
  })
}
