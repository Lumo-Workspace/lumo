// lib/editor/nodes/callout-node-view.tsx
import { useIntl } from 'react-intl'
import {
  NodeViewWrapper,
  NodeViewContent,
  type NodeViewProps,
} from '@tiptap/react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { CALLOUT_VARIANTS, getCalloutVariant } from './callout-variants'

/**
 * React node view for the Callout block. The gutter emoji is derived from the
 * `variant` attribute (never stored as text). While the editor is editable the
 * emoji is a dropdown trigger for switching variant; in the read-only
 * RichTextViewer it renders as a plain, non-interactive emoji.
 */
export function CalloutNodeView({
  node,
  updateAttributes,
  editor,
}: NodeViewProps) {
  const intl = useIntl()
  const variant = getCalloutVariant(node.attrs.variant)

  return (
    <NodeViewWrapper
      className='callout'
      data-callout=''
      data-variant={variant.key}
    >
      {editor.isEditable ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type='button'
              className='callout-icon callout-icon-button'
              contentEditable={false}
              aria-label={intl.formatMessage({
                id: 'editor.callout.changeType',
                defaultMessage: 'Change callout type',
              })}
              onMouseDown={event => event.preventDefault()}
            >
              {variant.emoji}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='start'>
            {CALLOUT_VARIANTS.map(v => (
              <DropdownMenuItem
                key={v.key}
                onSelect={() => updateAttributes({ variant: v.key })}
              >
                <span className='mr-2' aria-hidden>
                  {v.emoji}
                </span>
                {intl.formatMessage({ id: v.labelId })}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span className='callout-icon' contentEditable={false} aria-hidden>
          {variant.emoji}
        </span>
      )}
      <NodeViewContent className='callout-body' />
    </NodeViewWrapper>
  )
}
