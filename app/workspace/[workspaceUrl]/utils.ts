import { ApiTask, Page } from './types'

/** Returns true if the user is on macOS / iOS */
export const isMac =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform)

/** The submit modifier key label for the current OS */
export const submitModLabel = isMac ? '⌘' : 'Ctrl'

/** Returns true when the submit shortcut (Cmd/Ctrl + Enter) is pressed */
export function isSubmitShortcut(e: React.KeyboardEvent): boolean {
  return e.key === 'Enter' && (isMac ? e.metaKey : e.ctrlKey)
}

export function flattenTasks(
  nodes: (ApiTask & { children?: ApiTask[] })[]
): ApiTask[] {
  const result: ApiTask[] = []
  function walk(list: (ApiTask & { children?: ApiTask[] })[]) {
    for (const node of list) {
      const { children, ...task } = node
      result.push(task)
      if (children?.length) walk(children)
    }
  }
  walk(nodes)
  return result
}

/**
 * Format a timestamp according to the app's display rules:
 *  < 1 min         → "just now"
 *  1–59 min        → "23m ago"
 *  same day        → "Today 2:23 PM"
 *  yesterday       → "Yesterday"
 *  this year       → "Mar 21"
 *  older           → "Mar 21, 2025"
 */
export function formatTimestamp(
  date: Date | string,
  locale: string = 'en',
  messages?: {
    justNow?: string
    mAgo?: string
    today?: string
    yesterday?: string
  }
): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffMs / 60000)

  const justNow = messages?.justNow ?? 'just now'
  const mAgo = messages?.mAgo ?? '{m}m ago'
  const todayLabel = messages?.today ?? 'Today'
  const yesterdayLabel = messages?.yesterday ?? 'Yesterday'

  if (diffSec < 60) return justNow
  if (diffMin < 60) return mAgo.replace('{m}', String(diffMin))

  const sameDate = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()

  if (sameDate(d, now)) {
    const time = d.toLocaleTimeString(locale, {
      hour: 'numeric',
      minute: '2-digit',
    })
    return `${todayLabel} ${time}`
  }

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (sameDate(d, yesterday)) return yesterdayLabel

  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString(locale, { month: 'short', day: 'numeric' })
  }

  return d.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Convert a project name to a URL-safe slug.
 * e.g. "My Cool Project!" → "my-cool-project"
 */
export function slugifyProjectName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export const API_STATUS_LABEL: Record<string, string> = {
  TODO: 'Todo',
  IN_PROGRESS: 'In Progress',
  IN_REVIEW: 'In Review',
  DONE: 'Done',
}

/**
 * Format a due date for display.
 * Returns: "Today", "Tomorrow", "Apr 10", "Apr 10, 2027", or "" if null.
 */
export function formatDueDate(
  date: string | null | undefined,
  locale: string = 'en',
  messages?: { today?: string; tomorrow?: string }
): string {
  if (!date) return ''
  const d = new Date(date)
  const now = new Date()

  const todayLabel = messages?.today ?? 'Today'
  const tomorrowLabel = messages?.tomorrow ?? 'Tomorrow'

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()

  if (sameDay(d, now)) return todayLabel

  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (sameDay(d, tomorrow)) return tomorrowLabel

  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString(locale, { month: 'short', day: 'numeric' })
  }

  return d.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Returns true if the given due date is strictly before today.
 */
export function isOverdue(date: string | null | undefined): boolean {
  if (!date) return false
  const d = new Date(date)
  const today = new Date()
  d.setHours(0, 0, 0, 0)
  today.setHours(0, 0, 0, 0)
  return d.getTime() < today.getTime()
}

/**
 * Convert a Page to its URL path.
 * Used by WorkspaceApp for pushState and by TaskDetailPage for navigation.
 */
export function pageToPath(
  workspaceUrl: string,
  page: Page,
  project?: { name: string; id?: string } | null
): string {
  const base = `/workspace/${workspaceUrl}`
  switch (page) {
    case 'dashboard':
      return `${base}/dashboard`
    case 'my-tasks':
      return `${base}/my-tasks`
    case 'inbox':
      return `${base}/inbox`
    case 'projects':
      return `${base}/projects`
    case 'project-detail':
      return project
        ? `${base}/projects/${slugifyProjectName(project.name)}`
        : `${base}/projects`
    case 'documents':
      return `${base}/documents`
    case 'document-editor':
      return `${base}/documents/${project?.id ?? ''}`
    case 'drafts':
      return `${base}/drafts`
    default:
      return `${base}/my-tasks`
  }
}
