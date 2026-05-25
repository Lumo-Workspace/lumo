import TaskItem from '@tiptap/extension-task-item'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { TaskItemNodeView } from './task-item-node-view'

/**
 * Extends the stock TaskItem to carry data-task-id / data-task-identifier
 * when the row was extracted to a task. The CSS at `.task-item[data-task-id]`
 * suppresses the checkbox and shows a task badge instead.
 *
 * Also adds:
 * - `extractPending`: transient flag the hover button uses to mark "this row,
 *   this click." Stamped just before serialize, immediately reverted. Renders
 *   as data-extract-pending="true" — matches the server's marked selector.
 *   parseHTML returns null so it never round-trips from HTML back into the doc.
 * - NodeView: renders each task-item row with the hover "→ task" button.
 */
export const TaskItemWithLink = TaskItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      taskId: {
        default: null,
        parseHTML: el => el.getAttribute('data-task-id'),
        renderHTML: attrs =>
          attrs.taskId ? { 'data-task-id': attrs.taskId } : {},
      },
      taskIdentifier: {
        default: null,
        parseHTML: el => el.getAttribute('data-task-identifier'),
        renderHTML: attrs =>
          attrs.taskIdentifier
            ? { 'data-task-identifier': attrs.taskIdentifier }
            : {},
      },
      // Transient flag the hover button uses to mark "this row, this click."
      // Stamped just before serialize, immediately reverted. Renders as
      // data-extract-pending="true" — matches the server's marked selector.
      // parseHTML returns null so it never persists by round-tripping from HTML.
      extractPending: {
        default: null,
        parseHTML: () => null,
        renderHTML: attrs =>
          attrs.extractPending ? { 'data-extract-pending': 'true' } : {},
      },
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(TaskItemNodeView)
  },
})
