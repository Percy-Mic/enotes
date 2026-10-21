/** @type {import('next').NextConfig} */
const nextConfig = {
  // pg conditionally loads pg-cloudflare in the Cloudflare Workers runtime.
  // Next's file tracer may omit the Workerd-specific entrypoints, so include
  // them explicitly for the OpenNext bundle.
  outputFileTracingIncludes: {
    "**/*": [
      "./node_modules/pg-cloudflare/dist/**",
      "./node_modules/pg-cloudflare/esm/**",
    ],
  },
};

module.exports = nextConfig;
