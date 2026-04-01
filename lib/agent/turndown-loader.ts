/**
 * Opaque dynamic import for turndown.
 *
 * Turbopack statically analyses all import/require paths and mangles class
 * constructors during minification, breaking `new TurndownService()`.
 * We construct the module name at runtime so the bundler cannot resolve it.
 *
 * All consumer code should use `loadTurndown()` instead of requiring directly.
 */
export async function loadTurndown(): Promise<{
  new (options?: object): { turndown(html: string): string }
}> {
  const pkg = [process.env.TURNDOWN_PKG ?? 'turn', 'down'].join('')
  const mod = await import(/* webpackIgnore: true */ pkg)
  // turndown exports a class as default (CJS module.exports = TurndownService)
  return (mod.default ?? mod) as new (options?: object) => {
    turndown(html: string): string
  }
}
