import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["node-unrar-js", "quickjs-emscripten"],
  /* config options here */
  allowedDevOrigins: ["192.168.1.100"],
};

export default nextConfig;
