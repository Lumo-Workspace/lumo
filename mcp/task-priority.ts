/**
 * LUM-1284: the task priority scale as the standalone MCP server sees it —
 * its copy of `lib/task/priority.ts` (this package does not import the app's
 * lib). NONE means "not assessed" and is what a task gets when the agent
 * passes no priority: MCP never invents one.
 */
export const MCP_TASK_PRIORITIES = [
  'NONE',
  'LOW',
  'MEDIUM',
  'HIGH',
  'URGENT',
] as const

export type McpTaskPriority = (typeof MCP_TASK_PRIORITIES)[number]

/** The priority a new task is created with: the explicit one, else NONE. */
export function priorityForCreate(given?: McpTaskPriority): McpTaskPriority {
  return given ?? 'NONE'
}
