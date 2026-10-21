import type { NextConfig } from 'next';

const media = new URL(process.env.MEDIA_BASE_URL ?? 'http://localhost');

const config: NextConfig = {
  poweredByHeader: false,

  eslint: {
    ignoreDuringBuilds: true,
  },

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'biz-storefront-saas-production.up.railway.app',
        pathname: '/media/**',
      },
      {
        protocol: media.protocol === 'http:' ? 'http' : 'https',
        hostname: media.hostname,
        port: media.port,
      },
    ],
  },
  async headers() {
    return [{
      source: '/platform-admin/:path*',
      headers: [
        { key: 'Cache-Control', value: 'no-store, max-age=0' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        { key: 'X-Frame-Options', value: 'DENY' },
      ],
    }, {
      source: '/manage/:path*',
      headers: [
        { key: 'Cache-Control', value: 'no-store, max-age=0' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        { key: 'X-Frame-Options', value: 'DENY' },
      ],
    }];
  },
};

export default config;
