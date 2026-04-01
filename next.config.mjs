/** @type {import('next').NextConfig} */
const nextConfig = {
  // e2b depends on native Node APIs and optional deps (chalk v5 ESM-only)
  // that don't bundle cleanly. Keep it external.
  serverExternalPackages: ['@e2b/code-interpreter'],
}

export default nextConfig
