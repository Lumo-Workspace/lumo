import type { WrapSection, WrapRunOpts } from '../../lib/wrap-panel'
import { sanitizeField } from '../../lib/sanitize'
import {
  fetchUsageDraft,
  applyFragmentUsage,
  type ServerUsageDraft,
} from '../../lib/fragment-usage-api'

interface Credentials {
  token: string
  apiUrl: string
  workspaceSlug: string
}

/** Parse "1,3 5" → 0-based indices. "none" → []. */
export function parseUsedHandles(spec: string): number[] {
  if (spec.trim().toLowerCase() === 'none') return []
  return spec
    .split(/[\s,]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => parseInt(s, 10) - 1)
    .filter(n => Number.isInteger(n) && n >= 0)
}

/**
 * Wrap-panel section (LUM-300) that lists the context fragments this session
 * consumed and records the agent's vote on which it actually used. Voting is
 * non-interactive: the agent passes `lumo session wrap --used <indices>` (or
 * `--used none`). Without `--used`, the section just lists candidates and writes
 * nothing — edges stay null (honest "not voted"). Already-voted sessions skip.
 */
export class FragmentUsageSection implements WrapSection {
  title = 'Fragment-usage vote'
  private draft: ServerUsageDraft | null = null

  constructor(
    private deps: {
      creds: Credentials
      sessionId: string
      /** Raw --used value; undefined when the flag was not provided. */
      used?: string | undefined
    }
  ) {}

  async prepare(): Promise<boolean> {
    this.draft = await fetchUsageDraft(this.deps.creds, this.deps.sessionId)
    return this.draft.candidates.length > 0
  }

  async run(opts: WrapRunOpts): Promise<void> {
    const draft = this.draft
    if (!draft || draft.candidates.length === 0) return

    if (draft.alreadyVoted) {
      process.stdout.write('This session already voted — skipping.\n')
      return
    }

    process.stdout.write('Context fragments injected in this session:\n')
    draft.candidates.forEach((c, i) => {
      process.stdout.write(`  [${i + 1}] ${sanitizeField(c.label)}\n`)
    })

    if (opts.dryRun) {
      process.stdout.write('(dry-run, no changes)\n')
      return
    }

    if (this.deps.used === undefined) {
      process.stdout.write(
        'Use `lumo session wrap --used <indices>` (or `--used none`) to record which fragments you actually used.\n'
      )
      return
    }

    const idx = parseUsedHandles(this.deps.used)
    const inRange = (n: number) => n >= 0 && n < draft.candidates.length
    const usedRefs = idx.filter(inRange).map(i => ({
      fragmentType: draft.candidates[i]!.fragmentType,
      fragmentId: draft.candidates[i]!.fragmentId,
    }))
    const { used, unused } = await applyFragmentUsage(
      this.deps.creds,
      this.deps.sessionId,
      { usedRefs }
    )
    process.stdout.write(`Recorded: ${used} used, ${unused} unused.\n`)
  }
}
