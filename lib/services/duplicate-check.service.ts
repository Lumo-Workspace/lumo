import { listUsersByIds } from '@/lib/auth/user-batch'
import { GENERATION_MODEL } from '@/lib/ai/models'
import { generateObject } from 'ai'
import '@/lib/ai/gateway'
import { gateway } from '@/lib/ai/gateway'
import { z } from 'zod'
import { taskRepository } from '@/lib/repositories'
import { logger } from '@/lib/logger'
import { bigramSimilarity } from '@/lib/similarity'
import { embedTexts } from '@/lib/ai/embedding'

const matchSchema = z.object({
  matches: z.array(
    z.object({
      taskId: z.string(),
      score: z.number().min(0).max(1),
    })
  ),
})

export interface DuplicateMatch {
  taskId: string
  title: string
  number: number
  teamIdentifier: string
  status: string
  score: number
  assigneeName: string | null
  priority: string
}

/**
 * Check for duplicate/similar tasks using AI semantic matching.
 * Returns up to 5 matches with score >= 0.4.
 */
type DuplicateCheckRow = Awaited<
  ReturnType<typeof taskRepository.findForDuplicateCheck>
>[number]

/** LUM-1286 step 2: bigram hits from the recent tasks added to the embedding
 *  candidates, so a task whose embedding is not stamped yet still shows up. */
const BIGRAM_EXTRA_CANDIDATES = 5

function closestByBigram(
  title: string,
  tasks: DuplicateCheckRow[],
  n: number
): DuplicateCheckRow[] {
  return tasks
    .map(t => ({ t, s: bigramSimilarity(title, t.title) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map(x => x.t)
}

/**
 * LUM-1286 step 2: the project's `limit` tasks nearest by title embedding
 * (any age, not only the recent 200), plus the top bigram hits among the
 * recent ones. Falls back to the bigram top `limit` when the title cannot be
 * embedded or the project has no embeddings yet. Measured on 7 public repos
 * (1,555 duplicate pairs): embedding top-20 recall 79% vs bigram 69%, and
 * 87% vs 42% on Chinese titles.
 */
async function recallCandidates(
  title: string,
  projectId: string,
  recent: DuplicateCheckRow[],
  limit: number
): Promise<DuplicateCheckRow[]> {
  let ids: string[] = []
  try {
    const [vector] = await embedTexts([title])
    if (vector) {
      ids = await taskRepository.findNearestByTitleEmbedding(
        projectId,
        vector,
        limit
      )
    }
  } catch (err) {
    logger.warn(
      '[duplicate-check] embedding recall unavailable, using bigram:',
      err instanceof Error ? err.message : err
    )
  }
  if (ids.length === 0) return closestByBigram(title, recent, limit)

  const nearest = await taskRepository.findForDuplicateCheckByIds(projectId, ids)
  const seen = new Set(nearest.map(t => t.id))
  const extra = closestByBigram(
    title,
    recent.filter(t => !seen.has(t.id)),
    BIGRAM_EXTRA_CANDIDATES
  )
  return [...nearest, ...extra]
}

/**
 * Check for duplicate/similar tasks using AI semantic matching.
 * Returns up to 5 matches with score >= 0.4.
 */
export async function checkDuplicates(
  title: string,
  projectId: string,
  options: {
    abortSignal?: AbortSignal
    /** LUM-1286: send the LLM only this many recalled candidates (embedding
     *  recall, bigram fallback) instead of all recent titles — 200 titles
     *  took the model 15–35s locally. Omitted on the web path. */
    candidateLimit?: number
  } = {}
): Promise<DuplicateMatch[]> {
  const all = await taskRepository.findForDuplicateCheck(projectId)
  const tasks =
    options.candidateLimit === undefined
      ? all
      : await recallCandidates(title, projectId, all, options.candidateLimit)
  if (tasks.length === 0) return []

  const taskList = tasks.map(t => `${t.id}: ${t.title}`).join('\n')

  const prompt = `You are a duplicate task detector for a project management system.
Given a new task title and a list of existing tasks, identify semantically similar or duplicate tasks.

New task title: <title>${title}</title>

Existing tasks:
<tasks>
${taskList}
</tasks>

Return tasks that are semantically similar, with a similarity score between 0 and 1.
Only include tasks with score >= 0.4. Focus on semantic meaning, not just keyword overlap.
A score of 1.0 means exact duplicate, 0.8+ means very similar, 0.5-0.8 means related.`

  const { object } = await generateObject({
    model: gateway(GENERATION_MODEL),
    schema: matchSchema,
    prompt,
    ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
  })

  const taskMap = new Map(tasks.map(t => [t.id, t]))

  // Resolve assignee display names from Clerk
  const clerkIds = tasks
    .filter(t => t.assignee?.type === 'HUMAN' && t.assignee.member?.clerkId)
    .map(t => t.assignee!.member!.clerkId)
  const uniqueClerkIds = [...new Set(clerkIds)]

  let clerkNameMap = new Map<string, string>()
  if (uniqueClerkIds.length > 0) {
    try {
      const { getUserDirectory } = await import('@/lib/auth/users')
      const client = await getUserDirectory()
      const users = await listUsersByIds(client, uniqueClerkIds)
      clerkNameMap = new Map(
        users.map(u => [
          u.id,
          [u.firstName, u.lastName].filter(Boolean).join(' ') ||
            u.username ||
            'Unknown',
        ])
      )
    } catch {
      // Clerk lookup failed, assignee names will be null
    }
  }

  return object.matches
    .filter(m => m.score >= 0.4 && taskMap.has(m.taskId))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(m => {
      const t = taskMap.get(m.taskId)!
      let assigneeName: string | null = null
      if (t.assignee?.type === 'AGENT' && t.assignee.agent) {
        assigneeName = t.assignee.agent.name
      } else if (t.assignee?.type === 'HUMAN' && t.assignee.member?.clerkId) {
        assigneeName = clerkNameMap.get(t.assignee.member.clerkId) ?? null
      }

      return {
        taskId: t.id,
        title: t.title,
        number: t.number,
        teamIdentifier: t.team.identifier,
        status: t.status,
        score: m.score,
        assigneeName,
        priority: t.priority,
      }
    })
}

/**
 * LUM-1286: score at which `lumo task create` stops and asks the user. Higher
 * than the web modal's 0.4 floor, which only warns — the CLI gate blocks, so
 * "related" (0.5–0.8 in the prompt's scale) must not trip it.
 */
export const CLI_DUPLICATE_BLOCK_SCORE = 0.7

/**
 * LUM-1286: upper bound on the LLM call a CLI create waits for. Measured
 * 5–35s on GENERATION_MODEL even with the top-20 prefilter, so 8s never let
 * the gate fire; the user chose 45s over a faster model (LUM-1286 Decisions).
 */
export const CLI_DUPLICATE_TIMEOUT_MS = 45_000

/** LUM-1286: titles sent to the LLM after the bigram prefilter. */
export const CLI_DUPLICATE_CANDIDATES = 20

/**
 * LUM-1286: candidates strong enough to stop a CLI create for confirmation.
 * Fails open — a timeout or gateway error must never block creating a task
 * (our outage is not the customer's problem), so it logs and returns [].
 */
export async function findBlockingDuplicates(
  title: string,
  projectId: string,
  timeoutMs: number = CLI_DUPLICATE_TIMEOUT_MS
): Promise<DuplicateMatch[]> {
  const signal = AbortSignal.timeout(timeoutMs)
  // The signal cancels the LLM call; the race bounds the whole check (the
  // task read and the assignee-name lookup too), so a create never waits
  // past timeoutMs.
  const timedOut = new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), {
      once: true,
    })
  })
  try {
    const matches = await Promise.race([
      checkDuplicates(title, projectId, {
        abortSignal: signal,
        candidateLimit: CLI_DUPLICATE_CANDIDATES,
      }),
      timedOut,
    ])
    return matches.filter(m => m.score >= CLI_DUPLICATE_BLOCK_SCORE)
  } catch (err) {
    logger.warn('[duplicate-check] CLI check skipped (fail-open):', err)
    return []
  }
}
