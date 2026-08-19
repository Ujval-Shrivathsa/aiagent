import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "prisma"],
  ...(process.env.NODE_ENV !== "production" && {
    turbopack: {
      root: path.join(__dirname),
    },
  }),
};

export default nextConfig;
