'use client'

import { commentPreviewText } from '@/lib/html/comment-preview-text'

interface Props {
  authorName: string
  /** Plain-text body — already stripped of HTML and truncated for preview. */
  text: string
  onClick: () => void
  /** Whether the quote sits inside a reply (wider top padding) or inside the
   * inline reply input (also has horizontal margins). Drives layout classes. */
  variant: 'in-reply' | 'in-input'
}

/**
 * Preview-button for a quoted comment. Clicking scrolls to and briefly
 * highlights the original comment. Used both inside a reply that quotes
 * another comment, and inside the inline reply input as the "you're replying
 * to…" hint above the editor.
 */
export function CommentQuote({ authorName, text, onClick, variant }: Props) {
  const wrapperClass =
    variant === 'in-input'
      ? 'mx-3 mt-2.5 mb-1 w-[calc(100%-1.5rem)] text-left border-l-2 border-border pl-2.5 py-0.5 hover:border-muted-foreground hover:bg-muted rounded-r transition-colors'
      : 'mb-1.5 w-full text-left border-l-2 border-border pl-2.5 py-0.5 hover:border-muted-foreground hover:bg-muted rounded-r transition-colors'
  return (
    <button type='button' onClick={onClick} className={wrapperClass}>
      <p className='text-[11px] font-semibold text-muted-foreground mb-0.5'>
        {authorName}
      </p>
      <p className='text-[11px] text-muted-foreground line-clamp-2 leading-relaxed'>
        {text}
      </p>
    </button>
  )
}

/** First ~120 chars of plain text from an HTML comment body. */
export function previewCommentText(html: string): string {
  return commentPreviewText(html)
}
