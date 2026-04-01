/** @type {import('next').NextConfig} */
const nextConfig = {
  // Turbopack's SWC minifier mangles class constructors on the server,
  // breaking new Sandbox(), new Anthropic(), new Pusher() etc. at runtime.
  // Disable server-side minification to preserve constructor names.
  serverMinification: false,
}

export default nextConfig
