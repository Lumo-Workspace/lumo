import Document from '@tiptap/extension-document'

// Extend TipTap's Commands interface so addCommands() can declare `ensureTitle`
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    customDocument: {
      ensureTitle: () => ReturnType
    }
  }
}

// 自定义文档扩展，确保文档始终以标题开始
export const CustomDocument = Document.extend({
  content: 'heading block*', // 强制要求文档以 heading 开始，然后是其他块级元素

  // 在编辑器创建时确保有标题
  onCreate() {
    const { editor } = this
    if (editor) {
      // 检查文档是否为空或没有标题
      const { state } = editor
      const firstChild = state.doc.firstChild

      if (!firstChild || firstChild.type.name !== 'heading') {
        // 如果没有标题，在文档开头插入一个 H1
        editor.commands.insertContentAt(0, '<h1>无标题文档</h1>')
      }
    }
  },

  // 添加键盘快捷键来处理删除操作
  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const { editor } = this
        const { state } = editor
        const { selection } = state

        // 如果光标在标题中且标题是文档的第一个节点
        if (selection.empty && selection.$head.parent.type.name === 'heading') {
          const firstChild = state.doc.firstChild

          // 如果当前标题是文档的第一个（也是唯一的）标题
          if (
            firstChild &&
            firstChild.type.name === 'heading' &&
            selection.$head.parent === firstChild
          ) {
            // 如果标题为空，阻止删除
            if (firstChild.textContent === '') {
              return true
            }

            // 如果标题有内容但用户想删除所有内容，替换为默认标题
            if (
              selection.from === selection.to &&
              selection.from === firstChild.nodeSize - 2
            ) {
              editor.commands.updateAttributes('heading', { level: 1 })
              editor.commands.insertContent('无标题文档')
              return true
            }
          }
        }

        return false
      },

      Delete: () => {
        const { editor } = this
        const { state } = editor
        const { selection } = state

        // 类似的逻辑处理 Delete 键
        if (selection.empty && selection.$head.parent.type.name === 'heading') {
          const firstChild = state.doc.firstChild

          if (
            firstChild &&
            firstChild.type.name === 'heading' &&
            selection.$head.parent === firstChild
          ) {
            if (firstChild.textContent === '') {
              return true
            }
          }
        }

        return false
      },
    }
  },

  // 添加命令来确保文档始终有标题
  addCommands() {
    return {
      ensureTitle:
        () =>
        ({ commands }: { commands: any }) => {
          const { state } = commands.editor.state
          const firstChild = state.doc.firstChild

          if (!firstChild || firstChild.type.name !== 'heading') {
            return commands.insertContentAt(0, '<h1>无标题文档</h1>')
          }

          return true
        },
    }
  },
})

export default CustomDocument
