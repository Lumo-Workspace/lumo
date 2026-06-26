'use client'

import { createContext, useContext } from 'react'
import dynamic from 'next/dynamic'
import type { DescriptionEditorProps } from './DescriptionEditor'
import { DescriptionReadOnly } from './DescriptionReadOnly'

export type { TocItem } from './DescriptionEditor'

/**
 * Lazy entry point for {@link DescriptionEditor}.
 *
 * The tiptap/ProseMirror/lowlight editor stack is ~298KB gz. A static import
 * baked it into every workspace route's first-load JS graph (and duplicated it
 * across the list-route and detail-route chunks). Loading it through
 * `next/dynamic({ ssr: false })` splits it into a single shared async chunk
 * that downloads on the client only where the editor actually mounts — it never
 * ships to list/read views that don't render an editor.
 *
 * While the chunk downloads, the current `value` is shown via
 * {@link DescriptionReadOnly}: a lightweight, prose-styled read-only render of
 * the existing description HTML. The fallback is fed through context because
 * `next/dynamic`'s `loading` component receives no props. Server and client
 * both render this fallback first (ssr:false), so there is no hydration
 * mismatch and no blank flash before the editor hydrates.
 */
const FallbackContext = createContext<{
  value: string | null
  placeholder?: string | undefined
}>({ value: null })

const LazyDescriptionEditor = dynamic(
  () => import('./DescriptionEditor').then(m => m.DescriptionEditor),
  {
    ssr: false,
    loading: function EditorLoadingFallback() {
      const { value, placeholder } = useContext(FallbackContext)
      return <DescriptionReadOnly html={value} placeholder={placeholder} />
    },
  }
)

export function DescriptionEditor(props: DescriptionEditorProps) {
  return (
    <FallbackContext.Provider
      value={{ value: props.value, placeholder: props.placeholder }}
    >
      <LazyDescriptionEditor {...props} />
    </FallbackContext.Provider>
  )
}
