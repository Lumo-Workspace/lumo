/**
 * Build a full URL to a task page.
 */
export function buildTaskUrl(
  workspaceSlug: string,
  teamIdentifier: string,
  taskNumber: number
): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  return `${appUrl}/workspace/${workspaceSlug}/tasks/${teamIdentifier}-${taskNumber}`
}

/**
 * Build a task identifier string, e.g. "LUM-42".
 */
export function buildTaskIdentifier(
  teamIdentifier: string,
  taskNumber: number
): string {
  return `${teamIdentifier}-${taskNumber}`
}
