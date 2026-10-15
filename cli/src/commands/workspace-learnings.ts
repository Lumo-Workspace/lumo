import { apiCall, apiContext } from '../lib/test-case-api'
import { missingPluginMessage } from '../lib/plugin-route'
import { sanitizeField } from '../lib/sanitize'
import { fmtDay } from '../lib/format'

/**
 * LUM-1157 — `lumo workspace learnings [--repo <owner/name>] [--json]`: the
 * workspace's PR-review learnings (what reviewers told Lumo in review
 * threads), with or without a Lumo project. A learning of a repository
 * linked to no project appears in no project's memory, so this is where it
 * is found; `lumo memory rm <id>` deletes one.
 */

export interface WorkspaceLearningsOptions {
  repo?: string
  json?: boolean
}

export interface ReviewLearningView {
  id: string
  repo: string
  pathGlob: string | null
  learning: string
  ruleId: string
  authorLogin: string
  repositoryWide: boolean
  inProject: boolean
  createdAt: string
}

export interface ReviewLearningsView {
  learnings: ReviewLearningView[]
}

const PATH = '/api/workspaces/me/security-scan/learnings'
const NO_PLUGIN = missingPluginMessage('workspace learnings', 'security')

/** One block per learning: a header line, then the learning text. */
export function formatReviewLearnings(
  view: ReviewLearningsView,
  repo: string | undefined
): string {
  if (view.learnings.length === 0) {
    return repo
      ? `No learnings for ${sanitizeField(repo)}.`
      : 'No learnings in this workspace.'
  }
  const blocks = view.learnings.map(l => {
    const where = l.pathGlob
      ? `${sanitizeField(l.repo)}  ${sanitizeField(l.pathGlob)}`
      : sanitizeField(l.repo)
    const scope = l.repositoryWide ? 'repository' : 'source PR until it merges'
    const project = l.inProject ? '' : '  (no project)'
    return [
      `${sanitizeField(l.id)}  ${where}  @${sanitizeField(l.authorLogin)}  ${fmtDay(l.createdAt)}  ${scope}${project}`,
      `  ${sanitizeField(l.learning)}`,
    ].join('\n')
  })
  return [
    ...blocks,
    '',
    'Delete one with `lumo memory rm <id>` (exits 4 with a confirmation envelope until --confirm).',
  ].join('\n')
}

export async function workspaceLearnings(
  opts: WorkspaceLearningsOptions
): Promise<number | void> {
  const repo = opts.repo?.trim()
  if (opts.repo !== undefined && !/^[^/\s]+\/[^/\s]+$/.test(repo ?? '')) {
    console.error('Error: --repo must be owner/name.')
    return 1
  }
  const ctx = apiContext()
  if (!ctx) return 1
  const path = repo ? `${PATH}?repo=${encodeURIComponent(repo)}` : PATH
  const r = await apiCall<ReviewLearningsView>(
    ctx,
    path,
    {},
    'learnings',
    NO_PLUGIN
  )
  if (!r.ok || !r.data) return 1
  if (opts.json) {
    process.stdout.write(JSON.stringify(r.data, null, 2) + '\n')
    return
  }
  process.stdout.write(formatReviewLearnings(r.data, repo) + '\n')
}
