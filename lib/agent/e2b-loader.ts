/**
 * Opaque dynamic import for @e2b/code-interpreter.
 *
 * Uses `new Function()` so that Turbopack cannot statically analyse or bundle
 * the import — this avoids two production issues:
 *   1. Turbopack minification mangles the Sandbox class constructor
 *   2. serverExternalPackages causes ERR_REQUIRE_ESM (e2b → chalk v5 ESM-only)
 *
 * All consumer code should import from this module instead of directly from
 * '@e2b/code-interpreter' (except `import type` which is compile-time only).
 */
export async function loadE2B(): Promise<
  typeof import('@e2b/code-interpreter')
> {
  return (await new Function(
    'return import("@e2b/code-interpreter")'
  )()) as typeof import('@e2b/code-interpreter')
}
