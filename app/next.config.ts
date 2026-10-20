import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lambda Web Adapter で動かすため standalone 出力にする
  output: "standalone",
  // モノレポなので、トレースの起点をリポジトリのルートにする
  outputFileTracingRoot: path.join(__dirname, ".."),
  transpilePackages: ["@okiba/shared"],
  serverExternalPackages: ["mysql2"],
};

export default nextConfig;
