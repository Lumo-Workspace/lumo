import type { WrapSection, WrapRunOpts } from '../../lib/wrap-panel'
import { sanitizeField } from '../../lib/sanitize'
import { promptLine } from '../../lib/line-prompt'
import { formatMemoryReviewList } from '../../lib/memory-content'
import {
  fetchMemoryDraft,
  applyMemoryReview,
  type ServerMemoryDraft,
} from '../../lib/session-memory-api'

interface Credentials {
  token: string
  apiUrl: string
  workspaceSlug: string
}

/** Parse a one-line review instruction into 0-based row indices. */
export function parseReviewInstruction(line: string): {
  deleteIdx: number[]
  promoteIdx: number[]
} {
  const result = { deleteIdx: [] as number[], promoteIdx: [] as number[] }
  const re = /([dp])\s*([\d,\s]+)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    const nums = m[2]!
      .split(/[\s,]+/)
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => parseInt(s, 10) - 1)
      .filter(n => Number.isInteger(n) && n >= 0)
    if (m[1]!.toLowerCase() === 'd') result.deleteIdx.push(...nums)
    else result.promoteIdx.push(...nums)
  }
  return result
}

/**
 * Wrap-panel section that lists the Layer1 memories this session sedimented and
 * lets the user delete noise / promote keepers to project scope. Keeps its own
 * draft state between prepare() and run(). Dedup is server-side via watermark.
 */
export class MemoryReviewSection implements WrapSection {
  title = 'Memory review'
  private draft: ServerMemoryDraft | null = null

  constructor(private deps: { creds: Credentials; sessionId: string }) {}

  async prepare(): Promise<boolean> {
    this.draft = await fetchMemoryDraft(this.deps.creds, this.deps.sessionId)
    return this.draft.memories.length > 0
  }

  async run(opts: WrapRunOpts): Promise<void> {
    const draft = this.draft
    if (!draft || !draft.watermark || draft.memories.length === 0) return

    process.stdout.write(
      `This session recorded ${draft.memories.length} new memories:\n`
    )
    process.stdout.write(`${sanitizeField(formatMemoryReviewList(draft.memories))}\n`)

    if (opts.dryRun) {
      process.stdout.write('(dry-run, no changes)\n')
      return
    }

    if (opts.yes) {
      await this.apply(draft.watermark, [], [])
      return
    }

    const line = (
      await promptLine('[Enter] keep all  [d 1,3] delete  [p 2] promote to project  [s] skip > ')
    ).trim()

    if (line.toLowerCase() === 's') {
      process.stdout.write('Section skipped.\n')
      return
    }
    if (line === '') {
      await this.apply(draft.watermark, [], [])
      return
    }

    const { deleteIdx, promoteIdx } = parseReviewInstruction(line)
    const inRange = (n: number) => n >= 0 && n < draft.memories.length
    const deleteIds = deleteIdx.filter(inRange).map(i => draft.memories[i]!.id)
    const promoteIds = promoteIdx
      .filter(inRange)
      .map(i => draft.memories[i]!.id)
      .filter(id => !deleteIds.includes(id))
    await this.apply(draft.watermark, deleteIds, promoteIds)
  }

  private async apply(
    watermark: string,
    deleteIds: string[],
    promoteIds: string[]
  ): Promise<void> {
    const { deleted, promoted } = await applyMemoryReview(
      this.deps.creds,
      this.deps.sessionId,
      { watermark, deleteIds, promoteIds }
    )
    process.stdout.write(`Deleted ${deleted}, promoted ${promoted} to project scope.\n`)
  }
}
