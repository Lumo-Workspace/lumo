import { Mark, mergeAttributes } from '@tiptap/core'

export interface TaskLinkOptions {
  HTMLAttributes: Record<string, unknown>
}

/**
 * An anchor with `data-task-link="<taskId>"`. Parses from extract-tasks
 * output and survives round-trips. Click handling lives in the doc page —
 * this just preserves attrs and renders.
 */
export const TaskLink = Mark.create<TaskLinkOptions>({
  name: 'taskLink',

  // Must beat @tiptap/extension-link (priority 1000) for the
  // `a[data-task-link]` parse rule.
  priority: 1001,

  addOptions() {
    return { HTMLAttributes: {} }
  },

  addAttributes() {
    return {
      taskId: {
        default: null,
        parseHTML: el => el.getAttribute('data-task-link'),
        renderHTML: attrs =>
          attrs.taskId ? { 'data-task-link': attrs.taskId } : {},
      },
      identifier: {
        default: null,
        parseHTML: el => el.getAttribute('data-task-identifier'),
        renderHTML: attrs =>
          attrs.identifier ? { 'data-task-identifier': attrs.identifier } : {},
      },
      href: {
        default: null,
        parseHTML: el => el.getAttribute('href'),
        renderHTML: attrs => (attrs.href ? { href: attrs.href } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'a[data-task-link]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'a',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: 'task-link',
      }),
      0,
    ]
  },
})
