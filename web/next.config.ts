import type { NextConfig } from 'next';
const media = new URL(process.env.MEDIA_BASE_URL ?? 'http://localhost');
const config: NextConfig = {
  poweredByHeader: false,
  images: {
    remotePatterns: [{
      protocol: media.protocol === 'http:' ? 'http' : 'https',
      hostname: media.hostname,
      port: media.port,
    }],
  },
  async headers() {
    return [{
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