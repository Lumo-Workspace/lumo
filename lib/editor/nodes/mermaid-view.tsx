// lib/editor/nodes/mermaid-view.tsx
import { useEffect, useId, useState } from 'react'
import { useTheme } from 'next-themes'
import { useIntl } from 'react-intl'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { renderMermaid } from '../mermaid-render'

/**
 * Dual-state node view for the Mermaid block. Default state renders the
 * diagram SVG; clicking (only while editable) opens a source textarea that
 * re-renders on blur / "Done". A render/parse failure shows an inline error
 * placeholder with an "Edit" button — the source is never discarded. The
 * read-only RichTextViewer (editor.isEditable === false) only ever shows the
 * diagram.
 */
export function MermaidView({ node, updateAttributes, editor }: NodeViewProps) {
  const intl = useIntl()
  const { resolvedTheme } = useTheme()
  const source = (node.attrs.source as string) ?? ''

  // useId is pure (no Math.random in render, per the React rules). Strip the
  // colons next-id emits so it's a valid mermaid/DOM id.
  const domId = `mermaid-${useId().replace(/[^a-zA-Z0-9]/g, '')}`

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(source)
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const theme = resolvedTheme === 'dark' ? 'dark' : 'default'

  useEffect(() => {
    if (editing || source.trim() === '') return
    let cancelled = false
    ;(async () => {
      const result = await renderMermaid(domId, source, theme)
      if (cancelled) return
      if (result.ok) {
        setSvg(result.svg)
        setError(null)
      } else {
        setSvg(null)
        setError(result.error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [source, theme, editing, domId])

  // Keep the draft in sync if the source changes externally (undo, collab)
  // while not actively editing.
  useEffect(() => {
    if (!editing) setDraft(source)
  }, [source, editing])

  function openEditor() {
    if (!editor.isEditable) return
    setDraft(source)
    setEditing(true)
  }

  function commit() {
    updateAttributes({ source: draft })
    setEditing(false)
  }

  if (editing) {
    return (
      <NodeViewWrapper className='mermaid-block' data-type='mermaid'>
        <div className='mermaid-edit' contentEditable={false}>
          <textarea
            className='mermaid-source'
            value={draft}
            autoFocus
            aria-label={intl.formatMessage({
              id: 'editor.mermaid.sourceLabel',
              defaultMessage: 'Mermaid diagram source',
            })}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onMouseDown={e => e.stopPropagation()}
          />
          <button
            type='button'
            className='mermaid-done'
            onMouseDown={e => {
              // mousedown fires before the textarea blur; commit here so the
              // click isn't swallowed by the blur re-render.
              e.preventDefault()
              commit()
            }}
          >
            {intl.formatMessage({ id: 'editor.mermaid.done', defaultMessage: 'Done' })}
          </button>
        </div>
      </NodeViewWrapper>
    )
  }

  if (error) {
    return (
      <NodeViewWrapper className='mermaid-block' data-type='mermaid'>
        <div className='mermaid-error' contentEditable={false} role='alert'>
          <span className='mermaid-error-message'>
            {intl.formatMessage({
              id: 'editor.mermaid.error',
              defaultMessage: 'Diagram error',
            })}
            : {error}
          </span>
          {editor.isEditable && (
            <button
              type='button'
              className='mermaid-edit-button'
              onMouseDown={e => {
                e.preventDefault()
                openEditor()
              }}
            >
              {intl.formatMessage({ id: 'editor.mermaid.edit', defaultMessage: 'Edit' })}
            </button>
          )}
        </div>
      </NodeViewWrapper>
    )
  }

  if (source.trim() === '') {
    return (
      <NodeViewWrapper className='mermaid-block' data-type='mermaid'>
        <div
          className='mermaid-empty'
          contentEditable={false}
          onClick={openEditor}
        >
          {intl.formatMessage({
            id: 'editor.mermaid.empty',
            defaultMessage: 'Empty diagram — click to edit',
          })}
        </div>
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper className='mermaid-block' data-type='mermaid'>
      <div
        className='mermaid-diagram'
        contentEditable={false}
        onClick={openEditor}
        // mermaid output is sanitized (securityLevel: 'strict').
        dangerouslySetInnerHTML={{ __html: svg ?? '' }}
      />
    </NodeViewWrapper>
  )
}
