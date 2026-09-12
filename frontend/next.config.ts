import type { NextConfig } from "next";

/**
 * Next owns `/api/token` (and the dev-only `/api/spike/*`) on :3000; Person 1's
 * FastAPI backend owns `/api/routes` and `/api/imagery` on :8000. Proxying them
 * rather than calling :8000 from the browser keeps the seed frames same-origin,
 * which is not cosmetic: the night grade reads each frame back out of a
 * <canvas>, and a cross-origin image would taint it.
 */
const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  turbopack: { root: process.cwd() },
  async rewrites() {
    return [
      { source: "/api/routes", destination: `${BACKEND_ORIGIN}/api/routes` },
      {
        source: "/api/imagery/:path*",
        destination: `${BACKEND_ORIGIN}/api/imagery/:path*`,
      },
    ];
  },
};

export default nextConfig;
