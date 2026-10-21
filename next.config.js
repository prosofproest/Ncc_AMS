/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  images: { remotePatterns: [{ protocol: 'https', hostname: 'res.cloudinary.com' }] },
  // Keep heavy server libraries out of the webpack bundle (pdfkit needs its font files on disk)
  experimental: {
    serverComponentsExternalPackages: ['pdfkit', '@googleapis/sheets', 'firebase-admin', 'nodemailer', 'bcryptjs', 'exceljs', 'cloudinary'],
  },
  async headers() {
    return [
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
    ];
  },
};
module.exports = nextConfig;
