/**
 * LUM-988 — the on-disk directory name for a PR url, shared by `prepare.ts`
 * and `replay.ts`. One function on purpose: in LUM-975 the fetch and the
 * experiment scripts each derived the name their own way (every non-alnum
 * char vs runs of them), the context lookup silently found nothing, and a
 * whole round of "with context" results had no context in them.
 */
export function prKey(url: string): string {
  return url.replace(/[^a-zA-Z0-9]+/g, '_')
}
