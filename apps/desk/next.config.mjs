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
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
          },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
  poweredByHeader: false,
  transpilePackages: ["@pythia/ui"],
};

export default nextConfig;
