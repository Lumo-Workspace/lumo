import {
  initiativeRepository,
  type InitiativeUpdateRow,
  type InitiativeListRow,
  type InitiativeDetailRow,
  type InitiativeCreatedRow,
  type InitiativeCompositionRow,
} from '@/lib/repositories/initiative.repository'
import { getDefaultTeam } from '@/lib/team'
import type {
  CreateInitiativeInput,
  CreateInitiativeUpdateInput,
  UpdateInitiativeInput,
} from '@/lib/validation/initiative'
import type { InitiativeStatus, TaskStatus } from '@prisma/client'
import {
  milestoneState,
  type MilestoneState,
} from '@/lib/summaries/milestone-state'

/**
 * A materialised initiative as returned to callers. `identifier` is the
 * human-referenceable `<TEAM>-INIT-<number>` (e.g. `LUM-INIT-3`); the `INIT`
 * infix keeps initiative ids from colliding with task (`LUM-3`) or idea
 * (`LUM-I3`) ids in the same team namespace.
 */
export interface InitiativeListItem {
  id: string
  number: number
  identifier: string
  name: string
  status: InitiativeStatus
  taskCount: number
  ideaCount: number
  createdAt: Date
}

/** A consumed idea in an initiative's lineage (`<TEAM>-I<number>`). */
export interface InitiativeIdeaRef {
  id: string
  identifier: string
  statement: string
}

/** An attached task in an initiative's lineage (`<TEAM>-<number>`). */
export interface InitiativeTaskRef {
  id: string
  identifier: string
  title: string
  status: TaskStatus
}

export interface InitiativeDetail {
  id: string
  number: number
  identifier: string
  name: string
  assumptionNote: string | null
  status: InitiativeStatus
  createdAt: Date
  /** Ideas this initiative consumed (idea.initiativeId backref). */
  ideas: InitiativeIdeaRef[]
  /** Tasks materialised under this initiative (task.initiativeId backref). */
  tasks: InitiativeTaskRef[]
  /** Roll-up of the attached tasks for a progress read-out. */
  taskProgress: { total: number; done: number }
}

/** A milestone rolled up under an initiative, with its own tasks (LUM-678). */
export interface InitiativeMilestoneRef {
  id: string
  name: string
  slug: string
  /** LUM-714: active | completed | archived — no stored status any more. */
  state: MilestoneState
  tasks: InitiativeTaskRef[]
}

/**
 * The two-layer contents of an initiative (LUM-678): the milestones it contains
 * (each carrying its own tasks) plus the tasks attached DIRECTLY to the
 * initiative — i.e. not sitting under one of its milestones.
 */
export interface InitiativeComposition {
  id: string
  number: number
  identifier: string
  name: string
  milestones: InitiativeMilestoneRef[]
  directTasks: InitiativeTaskRef[]
}

function initiativeIdentifier(teamIdentifier: string, number: number): string {
  return `${teamIdentifier}-INIT-${number}`
}

/**
 * Partition an initiative's raw contents into its two layers (LUM-678), pure so
 * it is unit-testable in isolation. Resolution rule (design §两层容纳): a task
 * that sits under a milestone is represented via that milestone and is NOT also
 * counted as a direct task — so `directTasks` is exactly the initiative-linked
 * tasks whose `milestoneId` is null. This is what prevents double counting.
 */
export function composeInitiativeContents(
  row: InitiativeCompositionRow,
  teamIdentifier: string
): InitiativeComposition {
  const taskRef = (t: {
    id: string
    number: number
    title: string
    status: TaskStatus
  }): InitiativeTaskRef => ({
    id: t.id,
    identifier: `${teamIdentifier}-${t.number}`,
    title: t.title,
    status: t.status,
  })

  return {
    id: row.id,
    number: row.number,
    identifier: initiativeIdentifier(teamIdentifier, row.number),
    name: row.name,
    milestones: row.milestones.map(m => ({
      id: m.id,
      name: m.name,
      slug: m.slug,
      state: milestoneState(m),
      tasks: m.tasks.map(taskRef),
    })),
    directTasks: row.tasks.filter(t => t.milestoneId === null).map(taskRef),
  }
}

function toListItem(
  row: InitiativeListRow,
  teamIdentifier: string
): InitiativeListItem {
  return {
    id: row.id,
    number: row.number,
    identifier: initiativeIdentifier(teamIdentifier, row.number),
    name: row.name,
    status: row.status,
    taskCount: row._count.tasks,
    ideaCount: row._count.ideas,
    createdAt: row.createdAt,
  }
}

/** A freshly-created initiative has no lineage yet — counts are zero. */
function toCreatedItem(
  row: InitiativeCreatedRow,
  teamIdentifier: string
): InitiativeListItem {
  return {
    id: row.id,
    number: row.number,
    identifier: initiativeIdentifier(teamIdentifier, row.number),
    name: row.name,
    status: row.status,
    taskCount: 0,
    ideaCount: 0,
    createdAt: row.createdAt,
  }
}

function toDetail(
  row: InitiativeDetailRow,
  teamIdentifier: string
): InitiativeDetail {
  const done = row.tasks.filter(t => t.status === 'DONE').length
  return {
    id: row.id,
    number: row.number,
    identifier: initiativeIdentifier(teamIdentifier, row.number),
    name: row.name,
    assumptionNote: row.assumptionNote,
    status: row.status,
    createdAt: row.createdAt,
    ideas: row.ideas.map(i => ({
      id: i.id,
      identifier: `${teamIdentifier}-I${i.number}`,
      statement: i.statement,
    })),
    tasks: row.tasks.map(t => ({
      id: t.id,
      identifier: `${teamIdentifier}-${t.number}`,
      title: t.title,
      status: t.status,
    })),
    taskProgress: { total: row.tasks.length, done },
  }
}

const MAX_PROGRESS_UPDATES = 50

/**
 * Resolve an initiative ref within the caller's team (LUM-821): `LUM-INIT-3`,
 * a bare number `3`, or the cuid. A ref from another team is the same
 * 404 as a missing one, so the boundary can't be probed.
 */
async function resolveTeamInitiative(
  workspaceId: string,
  ref: string
): Promise<{ id: string; teamIdentifier: string }> {
  const notFound = () =>
    Object.assign(new Error(`Initiative ${ref} not found`), { status: 404 })
  const team = await getDefaultTeam(workspaceId)
  if (!team) throw notFound()
  const num = /^(?:([A-Za-z][A-Za-z0-9]*)-INIT-)?(\d+)$/i.exec(ref.trim())
  // A prefixed ref must name the caller's team: `VIC-INIT-1` used to be read
  // as "number 1 in my team" and silently wrote to the wrong initiative
  // (found by the LUM-821 cross-workspace isolation run). Bare numbers stay
  // team-relative.
  if (num?.[1] && num[1].toUpperCase() !== team.identifier.toUpperCase()) {
    throw notFound()
  }
  const row = num
    ? await initiativeRepository.findRefByTeamNumber(team.id, Number(num[2]))
    : await initiativeRepository.findRefById(ref.trim())
  if (!row || row.teamId !== team.id) throw notFound()
  return { id: row.id, teamIdentifier: team.identifier }
}

export interface InitiativeProgressUpdate {
  id: string
  authorMemberId: string
  body: string
  health: InitiativeUpdateRow['health']
  createdAt: Date
}

/**
 * Team-level initiative browse (LUM-673). Initiatives live above projects (no
 * projectId), so the team is resolved from the workspace's default team —
 * mirroring the idea pool. Every read is scoped to that team, so a caller
 * never sees another team's initiatives.
 *
 * Throws with `{ status }`: 404 when the initiative does not exist or belongs
 * to another team (the same response, so cross-team ids can't be probed).
 */
export const initiativeService = {
  /**
   * Create a team-level Initiative directly — no plan run required (LUM-673).
   * The team is resolved from the workspace's default team (mirroring ideas).
   * Throws with `{ status }`: 400 for a blank goal, 404 when the workspace has
   * no default team.
   */
  async create(args: {
    workspaceId: string
    input: CreateInitiativeInput
  }): Promise<InitiativeListItem> {
    const name = args.input.name.trim()
    if (!name) {
      throw Object.assign(new Error('Name is required'), {
        status: 400,
      })
    }

    const team = await getDefaultTeam(args.workspaceId)
    if (!team) {
      throw Object.assign(new Error('No default team for workspace'), {
        status: 404,
      })
    }

    const row = await initiativeRepository.create({
      teamId: team.id,
      workspaceId: args.workspaceId,
      name,
      assumptionNote: args.input.assumptionNote?.trim() || null,
    })

    return toCreatedItem(row, team.identifier)
  },

  /**
   * The caller team's initiatives (newest first). Empty when the workspace has
   * no default team — never another team's initiatives.
   */
  async listForWorkspace(args: {
    workspaceId: string
  }): Promise<InitiativeListItem[]> {
    const team = await getDefaultTeam(args.workspaceId)
    if (!team) return []
    const rows = await initiativeRepository.listByTeam(team.id)
    return rows.map(row => toListItem(row, team.identifier))
  },

  /**
   * One initiative with its lineage, scoped to the caller's team. Throws 404
   * when the workspace has no default team, the id is unknown, or the
   * initiative belongs to another team.
   */
  async getDetail(args: {
    workspaceId: string
    initiativeId: string
  }): Promise<InitiativeDetail> {
    const team = await getDefaultTeam(args.workspaceId)
    const notFound = () =>
      Object.assign(new Error('Initiative not found'), { status: 404 })
    if (!team) throw notFound()

    const row = await initiativeRepository.findDetailById(args.initiativeId)
    // Fail closed on a cross-team id — same 404 as a genuinely missing row so
    // the boundary can't be probed.
    if (!row || row.teamId !== team.id) throw notFound()

    return toDetail(row, team.identifier)
  },

  /**
   * Patch an initiative's scalar fields (LUM-821, `lumo initiative update`):
   * name (the goal), description, status, priority, start/target dates.
   */
  async update(args: {
    workspaceId: string
    ref: string
    input: UpdateInitiativeInput
  }): Promise<InitiativeListItem> {
    const { id, teamIdentifier } = await resolveTeamInitiative(
      args.workspaceId,
      args.ref
    )
    const { input } = args
    const data: Parameters<typeof initiativeRepository.update>[1] = {}
    if (input.name !== undefined) data.name = input.name
    if (input.description !== undefined) data.description = input.description
    if (input.status !== undefined) data.status = input.status
    if (input.priority !== undefined) data.priority = input.priority
    if (input.startDate !== undefined) data.startDate = input.startDate
    if (input.targetDate !== undefined) data.targetDate = input.targetDate
    const row = await initiativeRepository.update(id, data)
    return toListItem(row, teamIdentifier)
  },

  /** Append a progress post (LUM-821, `lumo initiative progress add`). */
  async postProgressUpdate(args: {
    workspaceId: string
    ref: string
    authorMemberId: string
    input: CreateInitiativeUpdateInput
  }): Promise<InitiativeProgressUpdate> {
    const { id } = await resolveTeamInitiative(args.workspaceId, args.ref)
    return initiativeRepository.createProgressUpdate({
      initiativeId: id,
      authorMemberId: args.authorMemberId,
      body: args.input.body,
      health: args.input.health ?? null,
    })
  },

  /** Newest-first progress posts, capped (LUM-821, `initiative progress list`). */
  async listProgressUpdates(args: {
    workspaceId: string
    ref: string
  }): Promise<InitiativeProgressUpdate[]> {
    const { id } = await resolveTeamInitiative(args.workspaceId, args.ref)
    return initiativeRepository.listProgressUpdates(id, MAX_PROGRESS_UPDATES)
  },

  /**
   * One initiative's two-layer contents (LUM-678): its milestones (each with
   * their tasks) plus its directly-attached tasks, de-duplicated so a task
   * under a milestone is never also listed as a direct task. Team-scoped with
   * the same fail-closed 404 as `getDetail`.
   */
  async getComposition(args: {
    workspaceId: string
    initiativeId: string
  }): Promise<InitiativeComposition> {
    const team = await getDefaultTeam(args.workspaceId)
    const notFound = () =>
      Object.assign(new Error('Initiative not found'), { status: 404 })
    if (!team) throw notFound()

    const row = await initiativeRepository.findCompositionById(
      args.initiativeId
    )
    if (!row || row.teamId !== team.id) throw notFound()

    return composeInitiativeContents(row, team.identifier)
  },
}
