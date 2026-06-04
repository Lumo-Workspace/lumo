// lib/editor/nodes/toggle-node-view.tsx
import { useIntl } from 'react-intl'
import {
  NodeViewWrapper,
  NodeViewContent,
  type NodeViewProps,
} from '@tiptap/react'

/**
 * React node view for the Toggle block. The chevron flips the persisted `open`
 * attribute; CSS (keyed off data-open) rotates the chevron and hides the
 * content when collapsed. The chevron stays interactive in the read-only
 * RichTextViewer so readers can expand/collapse (the change is local to the
 * viewer's editor state and is never saved).
 */
export function ToggleNodeView({ node, updateAttributes }: NodeViewProps) {
  const intl = useIntl()
  const open = node.attrs.open !== false

  return (
    <NodeViewWrapper
      className='toggle'
      data-toggle=''
      data-open={open ? 'true' : 'false'}
    >
      <button
        type='button'
        className='toggle-chevron'
        contentEditable={false}
        aria-expanded={open}
        aria-label={intl.formatMessage({
          id: 'editor.toggle.toggle',
          defaultMessage: 'Expand or collapse',
        })}
        onClick={() => updateAttributes({ open: !open })}
        onMouseDown={event => event.preventDefault()}
      >
        ▶
      </button>
      <NodeViewContent className='toggle-inner' />
    </NodeViewWrapper>
  )
}
