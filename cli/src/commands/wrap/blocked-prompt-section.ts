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
  title = '卡住检测'
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
    const where = top ? sanitizeField(top.label) : '某个操作'
    const count = top ? top.count : 0
    process.stdout.write(
      `看起来本次会话反复卡在 ${where}(${count} 次失败)。\n`
    )
    if (top?.lastErrorSummary) {
      process.stdout.write(`最后错误：${sanitizeField(top.lastErrorSummary)}\n`)
    }

    if (opts.dryRun) {
      process.stdout.write(
        `(dry-run，未改动；确认后会给 ${draft.taskIdentifier} 标 blocked)\n`
      )
      return
    }

    // Tagging the shared board is opt-in: it requires an explicit interactive
    // `y`. `--yes` (and non-TTY, where promptLine returns empty) deliberately
    // does NOT auto-tag — silently flipping shared board state is exactly what
    // LUM-153 set out to avoid. We surface the suggestion and move on.
    if (opts.yes) {
      process.stdout.write(
        `(--yes 不自动标记；如确认请交互式回答 y，或手动 \`lumo task update ${draft.taskIdentifier} --add-tag blocked\`)\n`
      )
      return
    }

    const choice = (
      await promptLine(`要在 ${draft.taskIdentifier} 标 blocked 吗？[y] 标记  [s] 跳过 > `)
    )
      .trim()
      .toLowerCase()

    if (choice === 'y') {
      await this.mark()
      return
    }
    // Empty / 's' / anything else → do nothing. Tagging is opt-in.
    process.stdout.write('已跳过，未标记。\n')
  }

  private async mark(): Promise<void> {
    const { taskIdentifier, tag } = await markTaskBlocked(
      this.deps.creds,
      this.deps.sessionId
    )
    process.stdout.write(`已给 ${taskIdentifier} 标 ${tag}。\n`)
  }
}
