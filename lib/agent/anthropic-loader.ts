/**
 * Opaque dynamic import for @anthropic-ai/sdk.
 *
 * Turbopack statically analyses all import paths and mangles class constructors
 * during minification, breaking `new Anthropic()`. We construct the module path
 * at runtime via process.env so the bundler cannot resolve it.
 *
 * All consumer code should use `loadAnthropic()` instead of importing directly
 * from '@anthropic-ai/sdk' (except `import type`).
 */
export async function loadAnthropic(): Promise<
  typeof import('@anthropic-ai/sdk')
> {
  const pkg = [process.env.ANTHROPIC_PKG_SCOPE ?? '@anthropic-ai', 'sdk'].join(
    '/'
  )
  return (await import(
    /* webpackIgnore: true */ pkg
  )) as typeof import('@anthropic-ai/sdk')
}
