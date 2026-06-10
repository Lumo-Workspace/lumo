import {
  formatStructureShrinks,
  structureShrinks,
} from '@/lib/utils/html-structure'

/**
 * Built-in structure guard on the document update path (LUM-410).
 *
 * The verify-live-doc.ts reconciliation moved server-side: an update whose
 * new render has fewer tables/rows/headings than its comparison base is
 * rejected with 422 unless the caller explicitly allows the shrink. Table
 * flattening (LUM-349) and stale-base section loss (#460) were silent
 * failure modes guarded only by a script someone had to remember to run —
 * this makes the guard hold even when nobody does.
 *
 * Scope is the caller's choice: full-document updates compare stored body vs
 * new body; section patches compare just the addressed section's old and new
 * renders (structure elsewhere in the document never factors in).
 */
export function assertNoStructureShrink(args: {
  oldHtml: string
  newHtml: string
  scope: 'document' | 'section'
  allowShrink: boolean | undefined
}): void {
  if (args.allowShrink) return
  const shrinks = structureShrinks(args.oldHtml, args.newHtml)
  if (shrinks.length === 0) return

  const target =
    args.scope === 'section' ? 'the addressed section' : 'the stored document'
  throw Object.assign(
    new Error(
      `Structure guard: this update shrinks ${target}'s structure (${formatStructureShrinks(shrinks)}). ` +
        `If the deletion is intentional, retry with allowShrink (CLI: --allow-shrink); otherwise ` +
        `re-read the current source (lumo doc show --raw) and rebase your edit on it.`
    ),
    { status: 422 }
  )
}
