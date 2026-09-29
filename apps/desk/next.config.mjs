import { tailscaleAccess } from "./tailscale.mjs";

const tailscale =
  process.env.NODE_ENV === "development" ? tailscaleAccess() : null;

/** @type {import("next").NextConfig} */
const nextConfig = {
  ...(tailscale ? { allowedDevOrigins: [tailscale.hostname] } : {}),
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        // The admitted content route owns framing by validated media type.
        // Next retains config headers over Response headers, so omit only here.
        source: "/:path((?!api/workspace/content$).*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
          },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
  // The route badge sat over Desk's own corner controls; build and runtime
  // errors still surface without it.
  devIndicators: false,
  poweredByHeader: false,
  transpilePackages: [
    "@pythia/ui",
    "@pythia/widget-sdk",
    "@pythia/market-data",
  ],
};

export default nextConfig;
