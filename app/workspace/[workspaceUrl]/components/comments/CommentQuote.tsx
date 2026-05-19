'use client'

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
      ? 'mx-3 mt-2.5 mb-1 w-[calc(100%-1.5rem)] text-left border-l-2 border-zinc-300 dark:border-zinc-600 pl-2.5 py-0.5 hover:border-zinc-400 dark:hover:border-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded-r transition-colors'
      : 'mb-1.5 w-full text-left border-l-2 border-zinc-300 dark:border-zinc-600 pl-2.5 py-0.5 hover:border-zinc-400 dark:hover:border-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded-r transition-colors'
  return (
    <button type='button' onClick={onClick} className={wrapperClass}>
      <p className='text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 mb-0.5'>
        {authorName}
      </p>
      <p className='text-[11px] text-zinc-400 dark:text-zinc-500 line-clamp-2 leading-relaxed'>
        {text}
      </p>
    </button>
  )
}

/**
 * Extract the first ~120 chars of plain text from an HTML comment body.
 * Falls back to a regex strip when running outside the DOM (SSR).
 */
export function previewCommentText(html: string): string {
  if (typeof document !== 'undefined') {
    const d = document.createElement('div')
    d.innerHTML = html
    return (d.textContent ?? d.innerText ?? '').trim().slice(0, 120) || '…'
  }
  return html.replace(/<[^>]+>/g, '').slice(0, 120)
}
