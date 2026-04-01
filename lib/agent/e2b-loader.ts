/**
 * Opaque dynamic import for @e2b/code-interpreter.
 *
 * Turbopack statically analyses even `new Function('return import(...)')` strings,
 * so we construct the module path at runtime via process.env to make it completely
 * invisible to the bundler. Non-NEXT_PUBLIC env vars are NOT inlined at build time.
 *
 * All consumer code should `import { loadE2B } from './e2b-loader'` instead of
 * importing directly from '@e2b/code-interpreter' (except `import type`).
 */
export async function loadE2B(): Promise<
  typeof import('@e2b/code-interpreter')
> {
  // Construct the module specifier at runtime — Turbopack cannot resolve this
  // at build time, so the import stays as a native Node.js import() call.
  const pkg = [process.env.E2B_PKG_SCOPE ?? '@e2b', 'code-interpreter'].join(
    '/'
  )
  return (await import(
    /* webpackIgnore: true */ pkg
  )) as typeof import('@e2b/code-interpreter')
}
