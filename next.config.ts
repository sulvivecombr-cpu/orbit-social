import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Pipe remote images through Vercel's image CDN so post media + avatars
  // get edge-cached + resized once, instead of every viewer hitting
  // Supabase storage / Mux thumbnails directly.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/public/**" },
      { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/render/image/public/**" },
      { protocol: "https", hostname: "image.mux.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
    ],
  },
  async redirects() {
    return [
      // The sign-up page lives at /signup; without this alias /register falls
      // through to the /[username] profile route and renders "User not found".
      { source: "/register", destination: "/signup", permanent: false },
    ];
  },
  async headers() {
    return [
      {
        // Apple fetches this file without following content sniffing rules
        // and rejects anything that is not JSON; it has no extension for
        // Next to infer the type from.
        source: "/.well-known/apple-app-site-association",
        headers: [{ key: "Content-Type", value: "application/json" }],
      },
      {
        source: "/:path*",
        headers: [
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-XSS-Protection",
            value: "1; mode=block",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            // Allow camera/mic/geolocation on our own origin so voice
            // posts, photo capture, and place lookups can prompt the
            // browser. Empty allowlists `()` disable the API outright,
            // which silently turns getUserMedia into NotAllowedError
            // even when the OS/browser-level permission is granted.
            key: "Permissions-Policy",
            value:
              "camera=(self), microphone=(self), geolocation=(self), interest-cohort=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
};

// Sentry: only wrap when both DSN and auth token are present (i.e., real prod build).
// Locally without these set, the bare config is used so the app builds without Sentry.
export default process.env.NEXT_PUBLIC_SENTRY_DSN && process.env.SENTRY_AUTH_TOKEN
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: !process.env.CI,
      widenClientFileUpload: true,
      tunnelRoute: "/monitoring",
      disableLogger: true,
      automaticVercelMonitors: false,
    })
  : nextConfig;
