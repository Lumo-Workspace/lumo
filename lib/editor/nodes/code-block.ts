import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { createCodeBlockLowlight } from './code-block-languages'
import { CodeBlockView } from './code-block-view'

/**
 * StarterKit's default `codeBlock` (plain, un-highlighted) is disabled in
 * {@link getBaseExtensions}; this lowlight-backed replacement registers the
 * curated grammar set and renders each block through {@link CodeBlockView},
 * which adds the language dropdown. Used by both the editor and the read-only
 * viewer so highlighting is identical on both sides.
 */
export const CodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView)
  },
}).configure({
  lowlight: createCodeBlockLowlight(),
  // Plain blocks (no language) shouldn't guess — leave them un-highlighted.
  defaultLanguage: null,
})
