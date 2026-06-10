import type { WrapSection, WrapRunOpts } from '../../lib/wrap-panel'
import { sanitizeField } from '../../lib/sanitize'
import { promptLine } from '../../lib/line-prompt'
import {
  fetchFailureSummary,
  markTaskBlocked,
  type ServerFailureDraft,
} from '../../lib/failure-summary-api'

interface Credentials {
  token: string
  apiUrl: string
  workspaceSlug: string
}

/**
 * Wrap-panel section (LUM-153) that detects repeated same-type failures in this
 * session and *prompts* whether to flag the bound task with a `blocked` tag.
 * Prompt-only by design — it never flips status automatically, and it only
 * shows up when the server says `shouldPrompt` (≥ threshold failures, bound
 * task, not already blocked). Confirming attaches the tag; the empty/`s`
 * default does nothing, so a stray Enter never tags the task.
 */
export class BlockedPromptSection implements WrapSection {
  title = 'Blocked check'
  private draft: ServerFailureDraft | null = null

  constructor(private deps: { creds: Credentials; sessionId: string }) {}

  async prepare(): Promise<boolean> {
    this.draft = await fetchFailureSummary(this.deps.creds, this.deps.sessionId)
    return this.draft.shouldPrompt
  }

  async run(opts: WrapRunOpts): Promise<void> {
    const draft = this.draft
    if (!draft || !draft.shouldPrompt || !draft.taskIdentifier) return

    const top = draft.topFailure
    const where = top ? sanitizeField(top.label) : 'an operation'
    const count = top ? top.count : 0
    process.stdout.write(
      `This session looks repeatedly stuck on ${where} (${count} failures).\n`
    )
    if (top?.lastErrorSummary) {
      process.stdout.write(`Last error: ${sanitizeField(top.lastErrorSummary)}\n`)
    }

    if (opts.dryRun) {
      process.stdout.write(
        `(dry-run, no changes; confirming would tag ${draft.taskIdentifier} blocked)\n`
      )
      return
    }

    // Tagging the shared board is opt-in: it requires an explicit interactive
    // `y`. `--yes` (and non-TTY, where promptLine returns empty) deliberately
    // does NOT auto-tag — silently flipping shared board state is exactly what
    // LUM-153 set out to avoid. We surface the suggestion and move on.
    if (opts.yes) {
      process.stdout.write(
        `(--yes does not auto-tag; answer y interactively, or run \`lumo task update ${draft.taskIdentifier} --add-tag blocked\` manually)\n`
      )
      return
    }

    const choice = (
      await promptLine(`Tag ${draft.taskIdentifier} as blocked? [y] tag  [s] skip > `)
    )
      .trim()
      .toLowerCase()

    if (choice === 'y') {
      await this.mark()
      return
    }
    // Empty / 's' / anything else → do nothing. Tagging is opt-in.
    process.stdout.write('Skipped — not tagged.\n')
  }

  private async mark(): Promise<void> {
    const { taskIdentifier, tag } = await markTaskBlocked(
      this.deps.creds,
      this.deps.sessionId
    )
    process.stdout.write(`Tagged ${taskIdentifier} with ${tag}.\n`)
  }
}
