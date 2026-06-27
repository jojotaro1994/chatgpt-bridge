/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Static export so nginx (or any static host) can serve the built PWA.
  // All routes are client-rendered; data is fetched via the server API at runtime.
  output: 'export',
  // The export is a pure SPA — dynamic params (e.g. /session/[id]) are
  // client-side. Disable Next's image optimizer (needs a server).
  images: { unoptimized: true },
  // Trailing slash: true avoids nginx 404 on /session/<id> → /session/<id>/
  trailingSlash: true,
};

export default nextConfig;
