import { projectRepository } from '@/lib/repositories/project.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { getDefaultTeam } from '@/lib/team'

// ── Types ───────────────────────────────────────────────────────────────────

export interface UpdateProjectInput {
  name?: string | undefined
  description?: string | null | undefined
  isIdea?: boolean | undefined
  defaultReviewerId?: string | null | undefined
}

// ── Project Service ─────────────────────────────────────────────────────────

export const projectService = {
  /** List projects with permission filtering and inProgressCount shaping. */
  async listProjects(workspaceId: string, memberId: string) {
    const projects = await projectRepository.findByWorkspace(
      workspaceId,
      memberId
    )

    return projects.map(({ tasks, ...p }) => ({
      ...p,
      inProgressCount: tasks.length,
    }))
  },

  /** Get a single project. Throws 404 if not found or if idea not owned by member. */
  async getProject(projectId: string, memberId: string) {
    const project = await projectRepository.findById(projectId)
    if (!project) {
      throw Object.assign(new Error('Project not found'), { status: 404 })
    }

    if (project.isIdea && project.createdByMemberId !== memberId) {
      throw Object.assign(new Error('Project not found'), { status: 404 })
    }

    return project
  },

  /** Create a new project. Uses getDefaultTeam(). */
  async createProject(
    workspaceId: string,
    memberId: string,
    data: {
      name: string
      description?: string | undefined
      isIdea?: boolean | undefined
    }
  ) {
    const defaultTeam = await getDefaultTeam(workspaceId)

    return projectRepository.create({
      workspaceId,
      teamId: defaultTeam!.id,
      createdByMemberId: memberId,
      name: data.name,
      description: data.description,
      isIdea: data.isIdea,
    })
  },

  /** Update a project. Validates idea edit permission and reviewer workspace membership. */
  async updateProject(
    projectId: string,
    memberId: string,
    input: UpdateProjectInput
  ) {
    const project = await projectRepository.findById(projectId)
    if (!project) {
      throw Object.assign(new Error('Project not found'), { status: 404 })
    }

    if (project.isIdea && project.createdByMemberId !== memberId) {
      throw Object.assign(new Error('Forbidden'), { status: 403 })
    }

    const data: import('@/lib/repositories/project.repository').ProjectUpdateData =
      {}
    if (input.name !== undefined) data.name = input.name
    if (input.description !== undefined) data.description = input.description
    if (input.isIdea !== undefined) data.isIdea = input.isIdea
    if (input.defaultReviewerId !== undefined) {
      if (input.defaultReviewerId !== null) {
        const reviewer = await memberRepository.findById(
          input.defaultReviewerId
        )
        if (!reviewer || reviewer.workspaceId !== project.workspaceId) {
          throw Object.assign(
            new Error('Reviewer is not a member of this workspace'),
            { status: 400 }
          )
        }
      }
      data.defaultReviewerId = input.defaultReviewerId
    }

    return projectRepository.update(projectId, data)
  },

  /** Delete a project. Validates idea delete permission. */
  async deleteProject(projectId: string, memberId: string) {
    const project = await projectRepository.findById(projectId)
    if (!project) {
      throw Object.assign(new Error('Project not found'), { status: 404 })
    }

    if (project.isIdea && project.createdByMemberId !== memberId) {
      throw Object.assign(new Error('Forbidden'), { status: 403 })
    }

    await projectRepository.delete(projectId)
  },
}
