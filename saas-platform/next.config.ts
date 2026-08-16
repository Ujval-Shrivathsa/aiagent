import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const nextConfig = {
  serverExternalPackages: ["@prisma/client", "prisma"],
  /* 
     Explicitly set the project root to prevent Next.js from scanning the 
     parent directory, which improves startup time and avoids workspace warnings.
  */
  outputFileTracingRoot: path.join(__dirname),
  swcMinify: false, // Disable SWC minification if blocked by policy
};

export default nextConfig;
