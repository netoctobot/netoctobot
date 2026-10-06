import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/admin-api/:path*",
        destination: `${process.env.API_PROXY_TARGET ?? "http://127.0.0.1:3000"}/admin/:path*`,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
