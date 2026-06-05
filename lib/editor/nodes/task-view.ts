import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { TaskViewBlock } from './task-view-block'
import {
  DEFAULT_TASK_VIEW_CONFIG,
  parseTaskViewConfig,
  type TaskViewConfig,
} from './task-view-config'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    taskView: {
      /** Insert a task-view block with the given config (default: all tasks). */
      setTaskView: (attrs?: { config?: TaskViewConfig }) => ReturnType
    }
  }
}

/**
 * Embedded task-view block: a leaf atom that stores only a query config (as a
 * JSON data attribute) and renders a live task list at runtime via
 * {@link TaskViewBlock}. The dynamic task data is never serialized into the
 * document — only the holder div + config round-trip. Same NodeView runs in
 * the editor and the read-only viewer (registered via getBaseExtensions).
 */
export const TaskView = Node.create({
  name: 'taskView',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      config: {
        default: DEFAULT_TASK_VIEW_CONFIG,
        parseHTML: el =>
          parseTaskViewConfig(el.getAttribute('data-task-view-config')),
        renderHTML: attrs => ({
          'data-task-view-config': JSON.stringify(attrs.config),
        }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-task-view]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-task-view': '' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(TaskViewBlock)
  },

  addCommands() {
    return {
      setTaskView:
        (attrs = {}) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { config: attrs.config ?? DEFAULT_TASK_VIEW_CONFIG },
          }),
    }
  },
})
