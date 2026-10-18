import { EXIT_USAGE } from '../lib/exit-codes'
import { docUpdate, type UpdateDocOptions } from './doc-update'
import { docShare, normalizeRole } from './doc-share'
import { docUnshare } from './doc-unshare'
import { docBind } from './doc-bind'
import { docUnbind } from './doc-unbind'
import { docShareList } from './doc-share-list'
import { docShow, type ShowDocOptions } from './doc-show'

/**
 * LUM-1233 batch 3c — sharing and task binding are fields of `doc update`,
 * like `--add-tag` / `--remove-tag` (docs/cli-command-structure.md 3c):
 *
 *   lumo doc update <doc> --add-member <m> [--role viewer|editor|manager]
 *   lumo doc update <doc> --remove-member <m>
 *   lumo doc update <doc> --add-task <LUM-N> / --remove-task <LUM-N>
 *   lumo doc show <doc> --members
 *
 * They replace `doc share`, `doc unshare`, `doc share-list`, `doc bind` and
 * `doc unbind`. Each flag is repeatable; field changes (title, body, tags …)
 * apply first, then members, then tasks, stopping at the first failure. With
 * only relation flags the body is not touched (stdin is not read).
 */
export interface DocRelationOptions {
  addMember?: string[] | undefined
  removeMember?: string[] | undefined
  role?: string | undefined
  addTask?: string[] | undefined
  removeTask?: string[] | undefined
}

const FIELD_KEYS: readonly (keyof UpdateDocOptions)[] = [
  'title',
  'content',
  'file',
  'scope',
  'project',
  'tag',
  'tagId',
  'addTag',
  'addTagId',
  'removeTag',
  'removeTagId',
  'ifRevision',
  'allowShrink',
]

const given = (v: unknown): boolean =>
  Array.isArray(v) ? v.length > 0 : v !== undefined && v !== false

/** Whether any document field (not a relation) was passed. Pure. */
export function hasFieldChange(opts: UpdateDocOptions): boolean {
  return FIELD_KEYS.some(k => given(opts[k]))
}

/** Whether any relation flag was passed. Pure. */
export function hasRelationChange(opts: DocRelationOptions): boolean {
  return (
    given(opts.addMember) ||
    given(opts.removeMember) ||
    given(opts.addTask) ||
    given(opts.removeTask)
  )
}

/** Usage problems of the relation flags (null = fine). Pure. */
export function relationUsageError(opts: DocRelationOptions): string | null {
  if (opts.role !== undefined && !given(opts.addMember))
    return '--role goes with --add-member'
  if (opts.role !== undefined && !normalizeRole(opts.role))
    return `invalid role "${opts.role}". Allowed: viewer, editor, manager`
  return null
}

const failed = (code: number | void): code is number =>
  typeof code === 'number' && code !== 0

export async function docUpdateWithRelations(
  reference: string | undefined,
  opts: UpdateDocOptions & DocRelationOptions
): Promise<number | void> {
  const usage = relationUsageError(opts)
  if (usage) {
    console.error(`Error: ${usage}`)
    return EXIT_USAGE
  }
  const relations = hasRelationChange(opts)
  if (!relations || hasFieldChange(opts)) {
    const code = await docUpdate(reference, opts)
    if (failed(code) || !relations) return code
  }
  const roleOpts = opts.role !== undefined ? { role: opts.role } : {}
  for (const m of opts.addMember ?? []) {
    const code = await docShare(reference, m, roleOpts)
    if (failed(code)) return code
  }
  for (const m of opts.removeMember ?? []) {
    const code = await docUnshare(reference, m)
    if (failed(code)) return code
  }
  for (const t of opts.addTask ?? []) {
    const code = await docBind(reference, t)
    if (failed(code)) return code
  }
  for (const t of opts.removeTask ?? []) {
    const code = await docUnbind(reference, t)
    if (failed(code)) return code
  }
}

/** `doc show <doc> --members` prints the share list (formerly `doc share-list`). */
export async function docShowWithMembers(
  reference: string | undefined,
  opts: ShowDocOptions & { members?: boolean | undefined }
): Promise<number | void> {
  if (!opts.members) return docShow(reference, opts)
  if (opts.raw || opts.section !== undefined || opts.json) {
    console.error(
      'Error: --members prints the share list; it cannot be combined with --raw, --section or --json'
    )
    return EXIT_USAGE
  }
  return docShareList(reference)
}
