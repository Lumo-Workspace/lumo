/** @type {import('next').NextConfig} */
const nextConfig = {
  // Prevent Next.js from bundling these packages — they use native bindings or
  // class syntax that breaks when minified. Treat them as Node.js externals instead.
  serverExternalPackages: ['@e2b/code-interpreter'],
}

export default nextConfig
