// lib/integrations/og-metadata/index.ts
//
// Server-only. Consumers should import from submodule paths
// (`@/lib/integrations/og-metadata/fetch` etc.) per the project's RSC
// boundary rule; this barrel exists for type re-exports only.

export type { OgData } from './parse'
export type { FetchResult } from './fetch'
