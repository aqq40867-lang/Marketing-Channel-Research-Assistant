import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Build a standalone bundle (.next/standalone) so the Docker image only copies that, not the full node_modules
  output: "standalone",
};

export default nextConfig;
