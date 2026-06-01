import { readCredentials } from '../lib/config'
import { runWrapPanel } from '../lib/wrap-panel'
import { ProgressCommentSection } from './wrap/progress-comment-section'

interface SessionWrapOptions {
  yes?: boolean
  dryRun?: boolean
}

/**
 * `lumo session wrap [--yes] [--dry-run]`
 *
 * Session-end wrap-up panel. v1 has a single section: draft a progress comment
 * from this session's unposted turnSummaries and post it (after y/e/s
 * confirmation) to the bound task. Designed as a multi-section panel so
 * LUM-152's memory-review section slots in without touching this command.
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

  const sections = [new ProgressCommentSection({ creds, sessionId })]
  await runWrapPanel(sections, {
    yes: options.yes === true,
    dryRun: options.dryRun === true,
  })
}
