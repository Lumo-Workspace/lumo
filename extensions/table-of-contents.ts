import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export interface TableOfContentsOptions {
  HTMLAttributes: Record<string, any>
}

export interface TableOfContentsStorage {
  headings: Array<{
    id: string
    level: number
    text: string
    element: HTMLElement
  }>
  updateHeadings: () => void
}

export const TableOfContents = Extension.create<
  TableOfContentsOptions,
  TableOfContentsStorage
>({
  name: 'tableOfContents',

  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  addStorage() {
    return {
      headings: [],
      updateHeadings: () => {},
    }
  },

  addGlobalAttributes() {
    return [
      {
        types: ['heading'],
        attributes: {
          id: {
            default: null,
            rendered: false,
          },
        },
      },
    ]
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('tableOfContents'),
        view: editorView => {
          const updateHeadings = () => {
            const headings: Array<{
              id: string
              level: number
              text: string
              element: HTMLElement
            }> = []

            const editorElement = editorView.dom as HTMLElement
            const headingElements = editorElement.querySelectorAll(
              'h1, h2, h3, h4, h5, h6'
            )

            headingElements.forEach((element, index) => {
              const headingElement = element as HTMLElement
              const level = parseInt(headingElement.tagName.charAt(1))
              const text = headingElement.textContent || ''
              const id = `heading-${index}-${text.toLowerCase().replace(/[^a-z0-9]/g, '-')}`

              // 设置 ID
              headingElement.id = id

              headings.push({
                id,
                level,
                text,
                element: headingElement,
              })
            })

            // 更新 storage
            this.storage.headings = headings
            this.storage.updateHeadings = updateHeadings

            // 触发自定义事件
            const event = new CustomEvent('tableOfContentsUpdate', {
              detail: { headings },
            })
            window.dispatchEvent(event)
          }

          // 初始更新
          setTimeout(updateHeadings, 100)

          return {
            update: () => {
              setTimeout(updateHeadings, 100)
            },
            destroy: () => {},
          }
        },
      }),
    ]
  },
})
