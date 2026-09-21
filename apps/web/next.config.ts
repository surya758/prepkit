import type { NextConfig } from "next";

// The browser only ever talks to this app. /api/* is passed on to the API server from here, so
// the session cookie is first-party — same site, no CORS, and SameSite=Lax is enough. The
// browser's Origin header is forwarded, which is what the API's same-origin check reads.
const apiUrl = (process.env.API_URL ?? "http://localhost:4000").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }];
  },
};

export default nextConfig;
