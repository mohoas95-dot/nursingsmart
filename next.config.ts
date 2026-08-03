import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  // Allow access to remote image placeholder.
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**', // This allows any path under the hostname
      },
    ],
  },
  output: 'standalone',
  transpilePackages: ['motion'],
  /**
   * هدرهای کش برای دارایی‌های ایستا.
   *
   * فایل‌های داخل `public/` به‌صورت پیش‌فرض بدون هدر کش سرو می‌شوند، پس مرورگر
   * در هر بازدید آن‌ها را دوباره اعتبارسنجی می‌کرد (یک رفت‌وبرگشت ۳۰۴ برای هر
   * تصویر). این تصاویر با تغییر محتوا نام جدید می‌گیرند یا دستی جایگزین
   * می‌شوند، پس کش یک‌روزه با `stale-while-revalidate` تعادل درستی بین سرعت و
   * تازگی است.
   */
  async headers() {
    return [
      {
        source: '/:file(logo|logo@2x|icon-192x192|icon-512x512|apple-touch-icon)\\.(png|svg)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' },
        ],
      },
      {
        source: '/avatars/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' },
        ],
      },
    ];
  },
  webpack: (config, {dev}) => {
    // HMR can be disabled via the DISABLE_HMR env var.
    // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
    if (dev && process.env.DISABLE_HMR === 'true') {
      config.watchOptions = {
        ignored: /.*/,
      };
    }
    return config;
  },
};

export default nextConfig;
