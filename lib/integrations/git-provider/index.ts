/**
 * LUM-1318 — the Git platform layer's public surface: platform ids, the
 * `GitProvider` port and its capabilities. The resolver (which loads the
 * adapters) is `./resolve.ts`, imported by the services that act on a PR.
 */
export * from './ids'
export * from './capabilities'
export type * from './types'
