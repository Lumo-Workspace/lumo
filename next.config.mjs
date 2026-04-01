/** @type {import('next').NextConfig} */
const nextConfig = {
  // These packages are loaded via opaque dynamic import (process.env-based paths)
  // so Turbopack cannot see them. Mark them as external so Next.js includes
  // their node_modules in the serverless function output.
  serverExternalPackages: [
    '@e2b/code-interpreter',
    '@anthropic-ai/sdk',
    'turndown',
  ],
}

export default nextConfig
