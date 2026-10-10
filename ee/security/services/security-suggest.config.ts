/**
 * LUM-740 — the suggested-disposition pass's switch. Import-light on
 * purpose: the PR write-back (imported statically by stage A) reads it to
 * decide whether EXTERNAL_TOOL inline comments must wait for the pass.
 */

/** `LUMO_SECURITY_SUGGEST=off` is the kill switch. */
export function isSuggestEnabled(): boolean {
  return process.env.LUMO_SECURITY_SUGGEST !== 'off'
}

/** Findings judged per scan; the rest stay unjudged (and get no suggestion). */
export const SUGGEST_MAX_PER_SCAN = 20
