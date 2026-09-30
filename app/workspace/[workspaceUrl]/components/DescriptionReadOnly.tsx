import { cn } from '@/lib/utils'
import { RichHtml } from '@/components/RichHtml'

interface DescriptionReadOnlyProps {
  /** Editor-serialized HTML to display read-only. Stored HTML is NOT
   *  sanitized on write, so it goes through RichHtml (LUM-916). */
  html: string | null
  /** Shown when there is no content yet, so the fallback is never a blank box. */
  placeholder?: string | undefined
  className?: string | undefined
}

/**
 * Lightweight, dependency-free read-only renderer for description / comment HTML.
 *
 * It carries none of the tiptap/ProseMirror/lowlight weight (~298KB gz) of
 * {@link DescriptionEditor}, so it can stand in for the editor while that chunk
 * lazily downloads (see {@link DescriptionEditorLazy}). The prose classes mirror
 * the editor's `EditorContent` styling so the swap from fallback → live editor
 * causes no visual/layout shift.
 */
export function DescriptionReadOnly({
  html,
  placeholder,
  className,
}: DescriptionReadOnlyProps) {
  const hasContent =
    html != null && html.trim() !== '' && html.trim() !== '<p></p>'

  if (!hasContent) {
    return (
      <div
        className={cn(
          'prose prose-sm dark:prose-invert max-w-none min-h-[80px] text-muted-foreground',
          className
        )}
      >
        {placeholder ?? null}
      </div>
    )
  }

  return (
    <RichHtml
      className={cn(
        'prose prose-sm dark:prose-invert max-w-none min-h-[80px] text-foreground',
        className
      )}
      html={html}
    />
  )
}
