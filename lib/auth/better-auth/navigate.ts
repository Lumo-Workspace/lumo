/**
 * LUM-1027 — full-page navigation after sign-in / sign-out, so server
 * components render with the new session cookie. A module of its own so
 * tests can observe it (jsdom cannot spy on window.location).
 */
export function hardNavigate(
  url: string,
  location: Pick<Location, 'assign'> = window.location
): void {
  location.assign(url)
}
