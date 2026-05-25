import TaskItem from '@tiptap/extension-task-item'

/**
 * Extends the stock TaskItem to carry data-task-id / data-task-identifier
 * when the row was extracted to a task. The CSS at `.task-item[data-task-id]`
 * suppresses the checkbox and shows a task badge instead.
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
    }
  },
})
