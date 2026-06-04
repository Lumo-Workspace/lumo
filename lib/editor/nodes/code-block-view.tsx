import { useIntl } from 'react-intl'
import {
  NodeViewWrapper,
  NodeViewContent,
  type NodeViewProps,
} from '@tiptap/react'
import { CODE_BLOCK_LANGUAGES } from './code-block-languages'

/**
 * React node view for lowlight code blocks. Renders the standard
 * `<pre><code>` structure (so lowlight's highlight decorations and the
 * `prose`/globals.css styling still apply) and overlays a language dropdown
 * in the top-right corner. The dropdown is only interactive while the editor
 * is editable — in the read-only {@link RichTextViewer} it is hidden, leaving
 * a clean highlighted block.
 */
export function CodeBlockView({
  node,
  updateAttributes,
  editor,
}: NodeViewProps) {
  const intl = useIntl()
  const language = (node.attrs.language as string | null) ?? ''

  return (
    <NodeViewWrapper className="relative code-block-wrapper">
      {editor.isEditable && (
        <select
          className="code-block-language-select"
          contentEditable={false}
          value={language}
          aria-label={intl.formatMessage({
            id: 'editor.codeBlock.languageLabel',
            defaultMessage: 'Code language',
          })}
          onChange={event =>
            updateAttributes({ language: event.target.value || null })
          }
          // Keep ProseMirror from treating the control as editable content.
          onMouseDown={event => event.stopPropagation()}
        >
          <option value="">
            {intl.formatMessage({
              id: 'editor.codeBlock.plainText',
              defaultMessage: 'Plain text',
            })}
          </option>
          {CODE_BLOCK_LANGUAGES.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
      <pre>
        <NodeViewContent<'code'> as="code" />
      </pre>
    </NodeViewWrapper>
  )
}
