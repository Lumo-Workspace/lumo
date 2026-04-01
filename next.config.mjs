/** @type {import('next').NextConfig} */
const nextConfig = {
  // e2b depends on native Node APIs and optional deps (chalk v5 ESM-only)
  // that don't bundle cleanly. Keep it external.
  serverExternalPackages: ['@e2b/code-interpreter'],
  // Turbopack's SWC minifier mangles class constructors on the server,
  // breaking new Sandbox(), new Anthropic(), new Pusher() etc. at runtime.
  // Disable server-side minification to preserve constructor names.
  serverMinification: false,
}

export default nextConfig
