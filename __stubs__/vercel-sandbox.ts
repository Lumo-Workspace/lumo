/**
 * Jest stand-in for `@vercel/sandbox` (LUM-735 v5). The real package is
 * ESM-only, so any suite that transitively reaches
 * `lib/integrations/vercel-sandbox` (stage A → managed-scan start → workflow
 * → step → service) would fail to load; `jest.config.js` maps it here. Tests
 * that exercise the sandbox mock the wrapper module, never this stub.
 */
export const Sandbox = { create: jest.fn(), list: jest.fn(), get: jest.fn() }
