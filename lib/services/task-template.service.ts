import type { WorkspaceRole } from '@prisma/client'
import { taskTemplateRepository } from '@/lib/repositories/task-template.repository'
import { preferenceRepository } from '@/lib/repositories/preference.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'
import {
  isSystemTemplateKey,
  listSystemTemplates,
} from '@/lib/task-templates/system'
import { normalizeRichText } from '@/lib/utils/markdown'
import type {
  CreateTaskTemplateInput,
  UpdateTaskTemplateInput,
} from '@/lib/validation/task-template'

/** One entry of the template picker / `lumo task template list`. */
export interface TaskTemplateView {
  /** null for system templates (they have no row). */
  id: string | null
  key: string
  name: string
  description: string | null
  /** Markdown source. */
  content: string
  /** `content` in the description's storage format (HTML), for prefill. */
  contentHtml: string
  isSystem: boolean
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'P2002'
}

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status })
}

/**
 * LUM-974: the caller's workspace role, for the write routes — they accept a
 * CLI bearer token, whose identity carries a member id but no role.
 */
async function memberRole(memberId: string): Promise<WorkspaceRole> {
  const role = await miscRepository.findMemberRoleById(memberId)
  if (!role) throw httpError(403, 'Workspace member not found')
  return role
}

/** Workspace templates are managed by OWNERs (the only admin role). */
function assertCanManage(role: WorkspaceRole): void {
  if (role !== 'OWNER') {
    throw httpError(403, 'Only workspace owners can manage task templates')
  }
}

function toView(t: {
  id: string | null
  key: string
  name: string
  description: string | null
  content: string
  isSystem: boolean
}): TaskTemplateView {
  return { ...t, contentHtml: normalizeRichText(t.content) ?? '' }
}

async function resolveLocale(opts: {
  locale?: string | null | undefined
  memberId?: string | null | undefined
}): Promise<string | null> {
  if (opts.locale) return opts.locale
  if (!opts.memberId) return null
  const pref = await preferenceRepository.findByMemberId(opts.memberId)
  return pref?.locale ?? null
}

async function listTemplates(
  workspaceId: string,
  opts: { locale?: string | null; memberId?: string | null } = {}
): Promise<TaskTemplateView[]> {
  const locale = await resolveLocale(opts)
  const system = listSystemTemplates(locale).map(t =>
    toView({ ...t, id: null, isSystem: true })
  )
  const custom = (
    await taskTemplateRepository.listByWorkspace(workspaceId)
  ).map(t => toView({ ...t, description: null, isSystem: false }))
  return [...system, ...custom]
}

/**
 * Markdown body of the template `key` (system or this workspace's).
 * 404 with the list command to run when the key is unknown.
 */
async function resolveContent(
  workspaceId: string,
  key: string,
  opts: { locale?: string | null; memberId?: string | null } = {}
): Promise<string> {
  if (isSystemTemplateKey(key)) {
    const locale = await resolveLocale(opts)
    const found = listSystemTemplates(locale).find(t => t.key === key)
    if (found) return found.content
  }
  const custom = await taskTemplateRepository.findByKey(workspaceId, key)
  if (!custom) {
    throw httpError(
      404,
      `Unknown task template "${key}". Run \`lumo task template list\` to see the available keys.`
    )
  }
  return custom.content
}

function assertKeyAvailable(key: string | undefined): void {
  if (key !== undefined && isSystemTemplateKey(key)) {
    throw httpError(409, `"${key}" is a built-in template key`)
  }
}

async function withUniqueKey<T>(
  key: string | undefined,
  run: () => Promise<T>
) {
  try {
    return await run()
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw httpError(409, `A task template with key "${key}" already exists`)
    }
    throw err
  }
}

async function createTemplate(
  workspaceId: string,
  role: WorkspaceRole,
  input: CreateTaskTemplateInput
): Promise<TaskTemplateView> {
  assertCanManage(role)
  assertKeyAvailable(input.key)
  const row = await withUniqueKey(input.key, () =>
    taskTemplateRepository.create({ workspaceId, ...input })
  )
  return toView({ ...row, description: null, isSystem: false })
}

async function updateTemplate(
  workspaceId: string,
  role: WorkspaceRole,
  id: string,
  input: UpdateTaskTemplateInput
): Promise<TaskTemplateView> {
  assertCanManage(role)
  assertKeyAvailable(input.key)
  const existing = await taskTemplateRepository.findInWorkspace(workspaceId, id)
  if (!existing) throw httpError(404, 'Task template not found')
  const row = await withUniqueKey(input.key, () =>
    taskTemplateRepository.update(id, input)
  )
  return toView({ ...row, description: null, isSystem: false })
}

async function deleteTemplate(
  workspaceId: string,
  role: WorkspaceRole,
  id: string
): Promise<void> {
  assertCanManage(role)
  const existing = await taskTemplateRepository.findInWorkspace(workspaceId, id)
  if (!existing) throw httpError(404, 'Task template not found')
  await taskTemplateRepository.delete(id)
}

export const taskTemplateService = {
  memberRole,
  listTemplates,
  resolveContent,
  createTemplate,
  updateTemplate,
  deleteTemplate,
}
