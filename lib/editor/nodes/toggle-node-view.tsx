// lib/editor/nodes/toggle-node-view.tsx
import { ChevronRight } from 'lucide-react'
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
        <ChevronRight size={14} aria-hidden />
      </button>
      {/* Tiptap React node views expose exactly one contentDOM, so this single
          NodeViewContent holds BOTH children (toggleSummary then toggleContent).
          Layout/visibility is done in CSS via the [data-toggle-summary] /
          [data-toggle-content] selectors, not separate React slots. */}
      <NodeViewContent className='toggle-inner' />
    </NodeViewWrapper>
  )
}
