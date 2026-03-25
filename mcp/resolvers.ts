import { prisma } from './db.js'

/**
 * Resolve a taskId that may be either:
 *   - a raw cuid:  "clx123abc..."
 *   - an identifier: "LUM-7"
 *
 * Returns the real task id string, or throws if not found.
 */
export async function resolveTaskId(
  taskIdOrIdentifier: string,
  workspaceId: string
): Promise<string> {
  // Raw cuid — return as-is
  if (!taskIdOrIdentifier.includes('-')) return taskIdOrIdentifier

  // "PREFIX-NUMBER" format
  const lastDash = taskIdOrIdentifier.lastIndexOf('-')
  const teamIdentifier = taskIdOrIdentifier.slice(0, lastDash).toUpperCase()
  const numberStr = taskIdOrIdentifier.slice(lastDash + 1)
  const number = parseInt(numberStr, 10)

  if (isNaN(number)) return taskIdOrIdentifier // fallback — let DB reject it

  const team = await prisma.team.findFirst({
    where: { workspaceId, identifier: teamIdentifier },
    select: { id: true },
  })
  if (!team)
    throw new Error(`Team with identifier "${teamIdentifier}" not found`)

  const task = await prisma.task.findUnique({
    where: { teamId_number: { teamId: team.id, number } },
    select: { id: true },
  })
  if (!task) throw new Error(`Task ${taskIdOrIdentifier} not found`)

  return task.id
}
