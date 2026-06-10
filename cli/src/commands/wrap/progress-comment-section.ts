import type { WrapSection, WrapRunOpts } from '../../lib/wrap-panel'
import { sanitizeField } from '../../lib/sanitize'
import { promptLine } from '../../lib/line-prompt'
import { editInEditor } from '../../lib/editor'
import {
  fetchProgressDraft,
  postProgressComment,
  type ServerProgressDraft,
} from '../../lib/progress-comment-api'

interface Credentials {
  token: string
  apiUrl: string
  workspaceSlug: string
}

const HEADER = 'Session progress'

/** Join turn summaries into a bulleted progress comment body under a header. */
export function formatProgressBody(summaries: string[]): string {
  return [HEADER, ...summaries.map(s => `- ${s}`)].join('\n')
}

/**
 * Wrap-panel section that drafts a progress comment from the session's
 * unposted turnSummaries and posts it after y/e/s confirmation. Holds its own
 * draft + body state between prepare() and run().
 */
export class ProgressCommentSection implements WrapSection {
  title = 'Progress comment'
  private draft: ServerProgressDraft | null = null
  private body = ''

  constructor(private deps: { creds: Credentials; sessionId: string }) {}

  async prepare(): Promise<boolean> {
    this.draft = await fetchProgressDraft(this.deps.creds, this.deps.sessionId)
    if (!this.draft.taskIdentifier || this.draft.summaries.length === 0) {
      return false
    }
    this.body = formatProgressBody(this.draft.summaries.map(s => s.turnSummary))
    return true
  }

  async run(opts: WrapRunOpts): Promise<void> {
    const draft = this.draft
    if (!draft || !draft.watermark) return

    // Preview: sanitize the server free-text before it hits the terminal.
    process.stdout.write(
      `Will post to ${draft.taskIdentifier} "${sanitizeField(draft.taskTitle ?? '')}":\n`
    )
    process.stdout.write(`${sanitizeField(this.body)}\n`)

    if (opts.dryRun) {
      process.stdout.write('(dry-run, not posted)\n')
      return
    }

    if (opts.yes) {
      await this.post(draft.watermark, this.body)
      return
    }

    const choice = (
      await promptLine('[y] post  [e] edit  [s] skip > ')
    ).toLowerCase()

    if (choice === 's' || choice === '') {
      process.stdout.write('Skipped.\n')
      return
    }
    if (choice === 'e') {
      const edited = (await editInEditor(this.body)).trim()
      if (edited.length === 0) {
        process.stdout.write('Empty body — skipped.\n')
        return
      }
      process.stdout.write(`${sanitizeField(edited)}\n`)
      const confirm = (await promptLine('[y] post  [s] skip > ')).toLowerCase()
      if (confirm !== 'y') {
        process.stdout.write('Skipped.\n')
        return
      }
      await this.post(draft.watermark, edited)
      return
    }
    if (choice === 'y') {
      await this.post(draft.watermark, this.body)
      return
    }
    process.stdout.write('Unrecognized choice — skipped.\n')
  }

  private async post(watermark: string, body: string): Promise<void> {
    const { commentId } = await postProgressComment(
      this.deps.creds,
      this.deps.sessionId,
      { body, watermark }
    )
    process.stdout.write(`Posted progress comment (comment ${commentId})\n`)
  }
}
