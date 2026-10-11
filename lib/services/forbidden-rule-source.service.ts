/**
 * LUM-1068 — the core's deterministic project rule source. On a hook event
 * of a task, read the project's default repository CLAUDE.md / AGENTS.md
 * (default branch), parse the `## Forbidden` rules
 * (`lib/boundary-crossing/forbidden-rules.ts`, the supported format is
 * documented there), compare them with the rule set stored in the core table
 * `ForbiddenRuleSnapshot`, and record every removed rule as POLICY_WEAKENING
 * (`recordForbiddenRuleWeakening`). No model call; runs with or without the
 * security plugin (with it, one removal is still one row — see
 * `boundary-crossing-policy-weakening.service.ts`).
 *
 * Contract:
 *  - the first observation of a project is a baseline: stored, nothing
 *    recorded;
 *  - a read error, a project without a linked repository, or both files
 *    missing decide nothing and leave the snapshot as it is (deleting BOTH
 *    files is therefore not reported — a missing installation looks the same);
 *  - of several instances observing one edit, the one whose compare-and-swap
 *    moves the snapshot records (exactly once); an instance still serving
 *    the text from before the last change (its 60 s cache) cannot flip the
 *    snapshot back within two minutes of that change;
 *  - a removal whose recording fails puts the snapshot back, so the next
 *    event retries it;
 *  - never throws (the caller is the hook detector, LUM-348 exit-0).
 *
 * Cost on the hook path: the default repository is looked up and the two
 * files are read at most once per 60 s per project per instance, and the
 * snapshot is only read when the text differs from the last one this
 * instance processed.
 */
import { createHash } from 'crypto'
import { logger } from '@/lib/logger'
import { projectRepository } from '@/lib/repositories/project.repository'
import { forbiddenRuleSnapshotRepository } from '@/lib/repositories/forbidden-rule-snapshot.repository'
import {
  FORBIDDEN_RULE_FILES,
  forbiddenRuleSourceText,
  parseForbiddenRuleSet,
  removedForbiddenRules,
  sameForbiddenRuleSet,
  type ForbiddenRuleSourceFile,
} from '@/lib/boundary-crossing/forbidden-rules'
import { recordForbiddenRuleWeakening } from '@/lib/services/boundary-crossing-policy-weakening.service'

const SOURCE_CACHE_TTL_MS = 60_000
/**
 * For this long after a change, a source equal to the one BEFORE it is a
 * stale cached read on another instance (the cache above lives up to 60 s),
 * not a revert: the snapshot is not flipped back — otherwise the flip and the
 * next fresh read would record the same removal twice. A real revert is
 * picked up by the first event after the window.
 */
const STALE_FLIP_WINDOW_MS = 2 * SOURCE_CACHE_TTL_MS
const _sourceCache = new Map<
  string,
  { files: ForbiddenRuleSourceFile[]; at: number }
>()
/** projectId → the source hash this instance last processed to the end. */
const _processed = new Map<string, string>()

/** Exported only for test teardown — do not call in production code. */
export function __resetForbiddenRuleSourceCache(): void {
  _sourceCache.clear()
  _processed.clear()
}

/** The cached files of a project, while fresh. */
function freshFiles(projectId: string): ForbiddenRuleSourceFile[] | null {
  const cached = _sourceCache.get(projectId)
  return cached && Date.now() - cached.at < SOURCE_CACHE_TTL_MS
    ? cached.files
    : null
}

/** CLAUDE.md and AGENTS.md of the repository (null = file absent). Throws
 *  on a read error. */
async function readFiles(input: {
  projectId: string
  workspaceId: string
  fullName: string
}): Promise<ForbiddenRuleSourceFile[]> {
  const cached = _sourceCache.get(input.projectId)
  if (cached && Date.now() - cached.at < SOURCE_CACHE_TTL_MS) {
    return cached.files
  }
  const { readRepoFile } = await import('@/lib/integrations/github/contents')
  const files = await Promise.all(
    FORBIDDEN_RULE_FILES.map(async path => ({
      path,
      content: await readRepoFile({
        workspaceId: input.workspaceId,
        fullName: input.fullName,
        path,
      }),
    }))
  )
  _sourceCache.set(input.projectId, { files, at: Date.now() })
  return files
}

function sourceHashOf(files: readonly ForbiddenRuleSourceFile[]): string {
  const h = createHash('sha256')
  for (const f of files) {
    h.update(`${f.path}\u0000`)
    h.update(f.content == null ? '\u0001absent' : `\u0002${f.content}`)
    h.update('\u0000')
  }
  return h.digest('hex')
}

/**
 * LUM-780 re-judge after the rule set changed: an OPEN blocking
 * POLICY_WEAKENING row whose text is back in the source (a restored rule)
 * becomes advisory. Fail-soft, lazily imported (the re-judge service reads
 * this module's source reader).
 */
async function rejudgeAfterChange(
  projectId: string,
  source: string
): Promise<void> {
  try {
    const { boundaryCrossingRejudgeService } =
      await import('@/lib/services/boundary-crossing-rejudge.service')
    await boundaryCrossingRejudgeService.rejudgePolicyWeakeningForProject({
      projectId,
      source,
    })
  } catch (error) {
    logger.warn(
      `[forbidden-rules] POLICY_WEAKENING re-judge failed for project ${projectId}: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}

export interface ForbiddenRuleObservation {
  outcome:
    | 'NO_REPOSITORY'
    | 'NO_SOURCE'
    | 'UNCHANGED'
    | 'BASELINE'
    | 'LOST_RACE'
    | 'STALE'
    | 'CHANGED'
    | 'ERROR'
  /** Rows written (CHANGED only). */
  recorded: number
}

export const forbiddenRuleSourceService = {
  /**
   * The project's current CLAUDE.md + AGENTS.md text (the plugin compiler's
   * concatenation); null when neither file exists or the project has no
   * repository. Throws on a read error. The core re-judge's reader when no
   * plugin provides one.
   */
  async readSource(input: {
    projectId: string
    workspaceId: string
    fullName: string
  }): Promise<string | null> {
    const files = await readFiles(input)
    if (files.every(f => f.content == null)) return null
    return forbiddenRuleSourceText(files)
  },

  /** One hook event's look at the project's Forbidden rules. Never throws. */
  async observe(input: {
    taskId: string
    projectId: string
    workspaceId: string
  }): Promise<ForbiddenRuleObservation> {
    try {
      // The cache answers without the repository lookup too: within its
      // 60 s a hook event costs no query and no GitHub read.
      let files = freshFiles(input.projectId)
      if (!files) {
        const repo = await projectRepository.findDefaultRepository(
          input.projectId
        )
        if (!repo) return { outcome: 'NO_REPOSITORY', recorded: 0 }
        files = await readFiles({
          projectId: input.projectId,
          workspaceId: input.workspaceId,
          fullName: repo.fullName,
        })
      }
      if (files.every(f => f.content == null))
        return { outcome: 'NO_SOURCE', recorded: 0 }

      const sourceHash = sourceHashOf(files)
      if (_processed.get(input.projectId) === sourceHash)
        return { outcome: 'UNCHANGED', recorded: 0 }

      const rules = parseForbiddenRuleSet(files)
      const snap = await forbiddenRuleSnapshotRepository.findByProject(
        input.projectId
      )
      if (!snap) {
        const created = await forbiddenRuleSnapshotRepository.createIfAbsent({
          projectId: input.projectId,
          sourceHash,
          rules,
        })
        _processed.set(input.projectId, sourceHash)
        return { outcome: created ? 'BASELINE' : 'LOST_RACE', recorded: 0 }
      }
      if (snap.sourceHash === sourceHash) {
        _processed.set(input.projectId, sourceHash)
        return { outcome: 'UNCHANGED', recorded: 0 }
      }
      if (
        snap.previousSourceHash === sourceHash &&
        Date.now() - snap.updatedAt.getTime() < STALE_FLIP_WINDOW_MS
      ) {
        // Not marked processed: re-evaluated by a later event.
        return { outcome: 'STALE', recorded: 0 }
      }

      const won = await forbiddenRuleSnapshotRepository.advance({
        projectId: input.projectId,
        fromSourceHash: snap.sourceHash,
        sourceHash,
        rules,
      })
      _processed.set(input.projectId, sourceHash)
      if (!won) return { outcome: 'LOST_RACE', recorded: 0 }

      const source = forbiddenRuleSourceText(files)
      const removed = removedForbiddenRules(snap.rules, rules)
      let recorded = 0
      if (removed.length > 0) {
        try {
          recorded = await recordForbiddenRuleWeakening({
            removed,
            taskId: input.taskId,
            projectId: input.projectId,
            source,
          })
        } catch (error) {
          // Put the snapshot back so the next event retries the removal
          // (rows already written are skipped then: they are open and name
          // the same rule) instead of losing it.
          _processed.delete(input.projectId)
          await forbiddenRuleSnapshotRepository
            .restore({
              projectId: input.projectId,
              fromSourceHash: sourceHash,
              to: {
                sourceHash: snap.sourceHash,
                previousSourceHash: snap.previousSourceHash,
                rules: snap.rules,
              },
            })
            .catch(() => false)
          throw error
        }
      }
      if (!sameForbiddenRuleSet(snap.rules, rules))
        await rejudgeAfterChange(input.projectId, source)
      return { outcome: 'CHANGED', recorded }
    } catch (error) {
      logger.warn(
        `[forbidden-rules] observation failed for project ${input.projectId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
      return { outcome: 'ERROR', recorded: 0 }
    }
  },
}
