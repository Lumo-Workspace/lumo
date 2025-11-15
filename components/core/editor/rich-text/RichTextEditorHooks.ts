import { useEffect } from 'react'
import type { Editor } from '@tiptap/react'

/**
 * Custom hook to sync external content with editor
 * Follows React 19 patterns for hooks
 */
export function useEditorContentSync(editor: Editor | null, content: string) {
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content)
    }
  }, [editor, content])
}

/**
 * Custom hook to sync editable state with editor
 */
export function useEditorEditableSync(
  editor: Editor | null,
  editable: boolean
) {
  useEffect(() => {
    if (editor) {
      editor.setEditable(editable)
    }
  }, [editor, editable])
}

/**
 * Custom hook to ensure first line is always H1
 */
export function useEnsureFirstLineH1(editor: Editor | null) {
  useEffect(() => {
    if (!editor) return

    const ensureFirstLineIsH1 = () => {
      const { state } = editor
      const firstChild = state.doc.firstChild

      if (firstChild && firstChild.type.name === 'heading') {
        const level = firstChild.attrs.level || 1
        if (level !== 1) {
          // 如果第一行不是 H1，使用命令转换为 H1（不改变光标位置）
          const { tr, selection } = state
          const firstNodePos = 1

          // 直接更新第一个节点的属性
          if (firstNodePos <= tr.doc.content.size) {
            const node = tr.doc.nodeAt(firstNodePos - 1)
            if (node && node.type.name === 'heading') {
              tr.setNodeMarkup(firstNodePos - 1, undefined, {
                ...node.attrs,
                level: 1,
              })
              // 恢复原来的光标位置
              tr.setSelection(selection)
              editor.view.dispatch(tr)
            }
          }
        }
      }
    }

    // 监听编辑器更新事件（使用防抖避免频繁触发）
    let timeoutId: NodeJS.Timeout
    const handleUpdate = () => {
      clearTimeout(timeoutId)
      timeoutId = setTimeout(() => {
        ensureFirstLineIsH1()
      }, 100)
    }

    editor.on('update', handleUpdate)

    // 初始化时也检查一次
    ensureFirstLineIsH1()

    return () => {
      clearTimeout(timeoutId)
      editor.off('update', handleUpdate)
    }
  }, [editor])
}
