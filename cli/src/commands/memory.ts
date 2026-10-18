import { EXIT_USAGE } from '../lib/exit-codes'
import { memoryTaskAdd } from './memory-task-add'
import { memoryProjectAdd } from './memory-project-add'
import { memoryTaskList } from './memory-task-list'
import { memoryProjectList } from './memory-project-list'
import { memoryPromote } from './memory-promote'
import {
  workspaceLearnings,
  type WorkspaceLearningsOptions,
} from './workspace-learnings'
import type { MemoryFlags } from '../lib/memory-content'

/**
 * LUM-1233 batch 3b — one `memory` noun; the scope is a flag.
 *
 *   lumo memory add  [--scope task|project] [--task <LUM-N>] [--project <ref>] --category …
 *   lumo memory list [--scope task|project] [--task <LUM-N>] [--project <ref>] [--learnings [--repo]]
 *   lumo memory update <memory> --scope project
 *
 * Scope: `--scope` when given; otherwise `--project <ref>` alone means the
 * project scope and anything else the task scope. The task is `--task` or the
 * session-bound task; the project is `--project` or the bound task's project.
 * Replaces `task memory add|list`, `project memory add|list`,
 * `memory promote` and `workspace learnings` (docs/cli-command-structure.md 3b).
 */
export type MemoryScope = 'task' | 'project'

export interface ScopeOptions {
  scope?: string | undefined
  task?: string | undefined
  project?: string | undefined
}

/** The scope a flag combination means, or a usage error. Pure. */
export function resolveMemoryScope(
  o: ScopeOptions
): { ok: true; scope: MemoryScope } | { ok: false; error: string } {
  const raw = o.scope?.trim().toLowerCase()
  if (raw !== undefined && raw !== 'task' && raw !== 'project')
    return {
      ok: false,
      error: `invalid --scope "${o.scope}". Valid values: task, project.`,
    }
  const scope: MemoryScope =
    (raw as MemoryScope | undefined) ??
    (o.project !== undefined && o.task === undefined ? 'project' : 'task')
  if (scope === 'project' && o.task !== undefined)
    return {
      ok: false,
      error: '--task goes with the task scope, not --scope project',
    }
  if (scope === 'task' && o.project !== undefined)
    return {
      ok: false,
      error: '--project goes with --scope project, not the task scope',
    }
  return { ok: true, scope }
}

type AddOptions = ScopeOptions &
  MemoryFlags & { category?: string; agent?: string }

export async function memoryAdd(o: AddOptions): Promise<number | void> {
  const r = resolveMemoryScope(o)
  if (!r.ok) {
    console.error(`Error: ${r.error}`)
    return EXIT_USAGE
  }
  return r.scope === 'task'
    ? memoryTaskAdd(o.task, o)
    : memoryProjectAdd(o.project, o)
}

type ListOptions = ScopeOptions & {
  category?: string
  limit?: string
  json?: boolean
  learnings?: boolean
  repo?: string
}

export async function memoryList(o: ListOptions): Promise<number | void> {
  if (o.learnings) {
    if (
      o.scope !== undefined ||
      o.task !== undefined ||
      o.project !== undefined
    ) {
      console.error(
        'Error: --learnings lists the workspace PR-review learnings; it takes no --scope, --task or --project'
      )
      return EXIT_USAGE
    }
    const opts: WorkspaceLearningsOptions = {}
    if (o.repo !== undefined) opts.repo = o.repo
    if (o.json !== undefined) opts.json = o.json
    return workspaceLearnings(opts)
  }
  if (o.repo !== undefined) {
    console.error('Error: --repo goes with --learnings')
    return EXIT_USAGE
  }
  const r = resolveMemoryScope(o)
  if (!r.ok) {
    console.error(`Error: ${r.error}`)
    return EXIT_USAGE
  }
  const listOpts = {
    ...(o.category !== undefined ? { category: o.category } : {}),
    ...(o.limit !== undefined ? { limit: o.limit } : {}),
    ...(o.json !== undefined ? { json: o.json } : {}),
  }
  return r.scope === 'task'
    ? memoryTaskList(o.task, listOpts)
    : memoryProjectList(o.project, listOpts)
}

/** `memory update <memory> --scope project` — the former `memory promote`. */
export async function memoryUpdate(
  memory: string | undefined,
  o: { scope?: string | undefined }
): Promise<number | void> {
  const scope = o.scope?.trim().toLowerCase()
  if (scope === undefined) {
    console.error(
      'Error: nothing to update — pass --scope project. Usage: lumo memory update <memory> --scope project'
    )
    return EXIT_USAGE
  }
  if (scope !== 'project') {
    console.error(
      `Error: --scope ${o.scope}: a memory only moves from the task scope to the project scope (--scope project)`
    )
    return EXIT_USAGE
  }
  return memoryPromote(memory)
}
