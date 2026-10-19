/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // This app lives in a subfolder of a repo with its own lockfile; pin the root to this folder.
  outputFileTracingRoot: import.meta.dirname,
};
export default nextConfig;
