const developmentOrigin =
  process.env.NODE_ENV === "development"
    ? process.env.PYTHIA_DESIGN_LAB_DEV_ORIGIN
    : undefined;

/** @type {import("next").NextConfig} */
const nextConfig = {
  ...(developmentOrigin
    ? { allowedDevOrigins: [new URL(developmentOrigin).hostname] }
    : {}),
  transpilePackages: ["@pythia/ui"],
};

export default nextConfig;
