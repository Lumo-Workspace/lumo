import { ReactRenderer } from '@tiptap/react'
import type { SuggestionOptions } from '@tiptap/suggestion'
import type { WorkspaceMemberInfo } from '../types'
import { MentionList, type MentionListRef } from './MentionList'

export function buildMentionSuggestion(
  members: WorkspaceMemberInfo[]
): Partial<SuggestionOptions> {
  return {
    items: ({ query }) => {
      const q = query.toLowerCase()
      return members.filter(m => m.name.toLowerCase().includes(q)).slice(0, 8)
    },

    render() {
      let renderer: ReactRenderer<MentionListRef> | null = null
      let popupEl: HTMLDivElement | null = null

      const destroyPopup = () => {
        renderer?.destroy()
        popupEl?.remove()
        renderer = null
        popupEl = null
      }

      const positionPopup = (clientRect: (() => DOMRect | null) | null) => {
        if (!popupEl || !clientRect) return
        const rect = clientRect()
        if (!rect) return
        const POPUP_WIDTH = 220
        const POPUP_MAX_HEIGHT = 280
        const GAP = 6

        let top = rect.bottom + GAP + window.scrollY
        let left = rect.left + window.scrollX

        // Flip above if not enough space below
        const spaceBelow = window.innerHeight - rect.bottom
        if (spaceBelow < POPUP_MAX_HEIGHT && rect.top > POPUP_MAX_HEIGHT) {
          top = rect.top - GAP + window.scrollY
          popupEl.style.transform = 'translateY(-100%)'
        } else {
          popupEl.style.transform = ''
        }

        // Clamp horizontally
        if (left + POPUP_WIDTH > window.innerWidth) {
          left = window.innerWidth - POPUP_WIDTH - 8
        }

        popupEl.style.top = `${top}px`
        popupEl.style.left = `${left}px`
      }

      return {
        onStart(props) {
          popupEl = document.createElement('div')
          popupEl.className = [
            'fixed z-[9999] w-[220px] max-h-[280px] overflow-y-auto',
            'bg-white dark:bg-zinc-900',
            'border border-zinc-200 dark:border-zinc-700',
            'rounded-lg shadow-lg',
          ].join(' ')
          document.body.appendChild(popupEl)

          renderer = new ReactRenderer(MentionList, {
            props,
            editor: props.editor,
          })
          popupEl.appendChild(renderer.element)
          positionPopup(props.clientRect ?? null)
        },

        onUpdate(props) {
          renderer?.updateProps(props)
          positionPopup(props.clientRect ?? null)
        },

        onKeyDown(props) {
          if (props.event.key === 'Escape') {
            destroyPopup()
            return true
          }
          return renderer?.ref?.onKeyDown(props) ?? false
        },

        onExit() {
          destroyPopup()
        },
      }
    },
  }
}
