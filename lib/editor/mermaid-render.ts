// lib/editor/mermaid-render.ts

/** Mermaid built-in theme name keyed off the app's resolved color scheme. */
export type MermaidTheme = 'default' | 'dark'

/** Discriminated result so callers never deal with thrown errors. */
export type MermaidRenderResult =
  | { ok: true; svg: string }
  | { ok: false; error: string }

// Track the theme mermaid was last initialized with so we only re-init on
// change (initialize is global + not free).
let initializedTheme: MermaidTheme | null = null

// Dynamic import keeps the heavy mermaid ESM bundle out of any static import
// graph (server bundles, jest module graph). Mirrors the dynamic-import
// pattern used for other ESM-only deps in this repo.
async function getMermaid() {
  const mod = await import('mermaid')
  return mod.default
}

/**
 * Parse + render a Mermaid diagram to an SVG string. Client-only (mermaid
 * needs the DOM). Returns a discriminated union instead of throwing so the
 * node view can show an inline error placeholder. `securityLevel: 'strict'`
 * neutralizes script/HTML injection in diagram labels.
 */
export async function renderMermaid(
  id: string,
  source: string,
  theme: MermaidTheme
): Promise<MermaidRenderResult> {
  try {
    const mermaid = await getMermaid()
    // mermaid.initialize() mutates global state. Browser JS is single-threaded,
    // so this check-then-set is safe; server-side concurrency would need a mutex.
    if (initializedTheme !== theme) {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme })
      initializedTheme = theme
    }
    // parse() throws on invalid syntax with a human-readable message.
    await mermaid.parse(source)
    // bindFunctions (interactive click handlers) is intentionally dropped:
    // diagrams render as static SVG. Add it to MermaidRenderResult if needed.
    const { svg } = await mermaid.render(id, source)
    return { ok: true, svg }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Test-only: clear the module-level init cache so test ordering is deterministic. */
export function _resetInitializedThemeForTest() {
  initializedTheme = null
}
