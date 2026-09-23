import { NextResponse } from 'next/server'
import { getUserWorkspace, requireWorkspaceMember } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'
import { projectRepository } from '@/lib/repositories/project.repository'
import { slugify } from '@/lib/utils/slugify'

// ── Workspace guards ────────────────────────────────────────────────────────

/**
 * Validate workspaceUrl query param and verify the caller owns it.
 * Returns the workspace result or a NextResponse error.
 */
export async function requireWorkspaceByUrl(
  userId: string,
  workspaceUrl: string | null
) {
  if (!workspaceUrl) {
    return NextResponse.json(
      { error: 'workspaceUrl is required' },
      { status: 400 }
    )
  }

  const ws = await getUserWorkspace(userId)
  if (!ws || ws.workspace.slug !== workspaceUrl) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return ws
}

/**
 * Get current user's workspace or return 404.
 */
export async function requireUserWorkspace(userId: string) {
  const ws = await getUserWorkspace(userId)
  if (!ws) {
    return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
  }
  return ws
}

// ── Resource loaders ────────────────────────────────────────────────────────

/**
 * Load a project by ID and verify the caller is a workspace member.
 * Also returns the workspace slug so routes that publish Pusher events
 * (create/update/delete/reorder) don't need a second roundtrip.
 */
export async function loadProjectAndMember(projectId: string, userId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { workspace: { select: { slug: true } } },
  })
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }
  const member = await requireWorkspaceMember(project.workspaceId, userId)
  if (member instanceof NextResponse) return member
  const { workspace, ...projectBase } = project
  return { project: projectBase, member, workspaceSlug: workspace.slug }
}

/**
 * Verify a task exists and the caller is a workspace member.
 * Accepts a pre-fetched task (with at least `project.workspaceId`).
 * Returns the original task (preserving its full type) + member, or a NextResponse.
 */
export async function requireTaskMember<
  T extends { project: { workspaceId: string } },
>(task: T | null, userId: string) {
  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }
  const member = await requireWorkspaceMember(task.project.workspaceId, userId)
  if (member instanceof NextResponse) return member
  return { task, member }
}

// ── Ref resolvers ───────────────────────────────────────────────────────────

/**
 * Resolve a human-friendly `projectRef` (name or slug, case-insensitive) to
 * a project id within a workspace. Throws 404 with the ref echoed back when
 * no project matches, 409 when more than one matches.
 */
export async function resolveProjectRef(
  workspaceId: string,
  projectRef: string
): Promise<string> {
  const ref = projectRef.trim().toLowerCase()
  const refSlug = slugify(projectRef)
  const projects = await projectRepository.findByWorkspaceNonIdea(workspaceId)
  const matches = projects.filter(
    p => p.name.toLowerCase() === ref || slugify(p.name) === refSlug
  )
  if (matches.length === 1) return matches[0]!.id
  if (matches.length === 0) {
    throw Object.assign(new Error(`No project matches "${projectRef}"`), {
      status: 404,
    })
  }
  throw Object.assign(
    new Error(
      `Multiple projects match "${projectRef}". Use a more specific name.`
    ),
    { status: 409 }
  )
}

// ── Validation helpers ──────────────────────────────────────────────────────

/**
 * Build a 400 response from a failed Zod parse result.
 * Use with: `if (!parsed.success) return zodError(parsed)`
 * This preserves TypeScript's type narrowing on `parsed.data`.
 */
export function zodError(parsed: {
  error: { issues: { message: string }[] }
}): NextResponse {
  return NextResponse.json(
    { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
    { status: 400 }
  )
}

/**
 * Check if an error is a Prisma unique constraint violation (P2002).
 */
export function isPrismaUniqueError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === 'P2002'
  )
}

/**
 * Map a service error (`Object.assign(new Error(msg), { status })`) to a JSON
 * response: its status + message, or a logged, message-free 500.
 */
export function serviceErrorResponse(err: unknown, tag: string): NextResponse {
  const errStatus = (err as { status?: unknown })?.status
  const status = typeof errStatus === 'number' ? errStatus : 500
  if (status === 500) {
    console.error(`${tag} error:`, err)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
  const message = err instanceof Error ? err.message : 'Error'
  return NextResponse.json({ error: message }, { status })
}
