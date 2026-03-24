import { ReactRenderer } from '@tiptap/react'
import type { SuggestionOptions } from '@tiptap/suggestion'
import type { WorkspaceMemberInfo, ApiTask } from '../types'
import {
  MentionList,
  type MentionListRef,
  type MentionItem,
} from './MentionList'

export function buildMentionSuggestion(
  members: WorkspaceMemberInfo[],
  tasks: ApiTask[] = []
): Partial<SuggestionOptions> {
  return {
    items: ({ query }): MentionItem[] => {
      const q = query.toLowerCase()

      const userItems: MentionItem[] = members
        .filter(m => m.name.toLowerCase().includes(q))
        .slice(0, 5)
        .map(m => ({
          type: 'user',
          id: m.clerkId,
          label: m.name,
          imageUrl: m.imageUrl,
        }))

      const taskItems: MentionItem[] = tasks
        .filter(
          t =>
            t.title.toLowerCase().includes(q) ||
            `${t.teamIdentifier}-${t.number}`.toLowerCase().includes(q)
        )
        .slice(0, 5)
        .map(t => ({
          type: 'task',
          id: t.id,
          label: `${t.teamIdentifier}-${t.number}`,
          title: t.title,
          status: t.status,
        }))

      return [...userItems, ...taskItems]
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
        const POPUP_WIDTH = 260
        const POPUP_MAX_HEIGHT = 320
        const GAP = 6

        let top = rect.bottom + GAP + window.scrollY
        let left = rect.left + window.scrollX

        const spaceBelow = window.innerHeight - rect.bottom
        if (spaceBelow < POPUP_MAX_HEIGHT && rect.top > POPUP_MAX_HEIGHT) {
          top = rect.top - GAP + window.scrollY
          popupEl.style.transform = 'translateY(-100%)'
        } else {
          popupEl.style.transform = ''
        }

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
            'fixed z-[9999] w-[260px] max-h-[320px] overflow-y-auto',
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
