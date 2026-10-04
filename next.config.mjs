/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [{ source: '/sw.js', destination: '/sw' }];
  },
};

export default nextConfig;
