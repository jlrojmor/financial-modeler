import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Use cwd as root so cache/lockfile are from this app (avoids parent /Users/JLRM lockfile)
    root: process.cwd(),
  },
};

export default nextConfig;
