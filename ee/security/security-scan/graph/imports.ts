/**
 * LUM-739 — resolve an import specifier to the repo paths it may live at.
 * Pure: the caller (the hunt service) tries the candidates against GitHub in
 * order and keeps the first that exists. Only `@/` (tsconfig alias to the
 * repo root) and relative specifiers resolve; bare packages never do.
 */
import { posix } from 'node:path'

const EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/

/** TS/TSX source the subgraph can parse (declaration files carry no calls). */
export function isGraphSourcePath(path: string): boolean {
  return /\.tsx?$/.test(path) && !/\.d\.ts$/.test(path)
}

export function resolveImportCandidates(
  importer: string,
  spec: string
): string[] {
  let base: string
  if (spec.startsWith('@/')) base = spec.slice(2)
  else if (spec.startsWith('./') || spec.startsWith('../'))
    base = posix.normalize(posix.join(posix.dirname(importer), spec))
  else return []
  if (base.startsWith('../') || base === '..' || base.startsWith('/')) return []
  if (base.startsWith('./')) base = base.slice(2)
  if (EXT.test(base)) return /\.tsx?$/.test(base) ? [base] : []
  return [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]
}
