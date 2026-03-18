import { ApiTask } from './types';

export function flattenTasks(
  nodes: (ApiTask & { children?: ApiTask[] })[],
): ApiTask[] {
  const result: ApiTask[] = [];
  function walk(list: (ApiTask & { children?: ApiTask[] })[]) {
    for (const node of list) {
      const { children, ...task } = node;
      result.push(task);
      if (children?.length) walk(children);
    }
  }
  walk(nodes);
  return result;
}

export const API_STATUS_LABEL: Record<string, string> = {
  TODO: 'Todo',
  IN_PROGRESS: 'In Progress',
  DONE: 'Done',
};
