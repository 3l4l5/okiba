import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@okiba/shared"],
  // monorepo の standalone 出力に workspace の依存を含める
  outputFileTracingRoot: path.join(__dirname, ".."),
  serverExternalPackages: ["mysql2"],
};

export default nextConfig;
