import { ApiTask } from './types'

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

export const API_STATUS_LABEL: Record<string, string> = {
  TODO: 'Todo',
  IN_PROGRESS: 'In Progress',
  IN_REVIEW: 'In Review',
  DONE: 'Done',
}
