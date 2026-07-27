import type { Metadata, Viewport } from 'next';
import { Vazirmatn, Lalezar, Barlow_Condensed } from 'next/font/google';
import './globals.css';

const vazirmatn = Vazirmatn({
  subsets: ['arabic', 'latin'],
  variable: '--font-vazirmatn',
  display: 'swap',
});

// فونت تیتر-مانند فارسی برای اسامی و عناوین برگه چاپ
const lalezar = Lalezar({
  subsets: ['arabic', 'latin'],
  weight: '400',
  variable: '--font-titr',
  display: 'swap',
});

// فونت باریک و کم‌رنگ حروف انگلیسی شیفت در برگهٔ چاپ؛ فرم هندسی و کشیدهٔ
// Barlow Condensed Light با نمونهٔ Tracing ارائه‌شده برای تکمیل با مداد هماهنگ است.
const tracingFont = Barlow_Condensed({
  subsets: ['latin'],
  weight: '300',
  variable: '--font-tracing',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'سامانه هوشمند برنامه‌ریزی شیفت پرستاری بیمارستان',
  description: 'سیستم هوشمند تخصیص خودکار و عادلانه شیفت پرسنل با موتور الگوریتمی پیشرفته',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'NursePlan',
  },
};

export const viewport: Viewport = {
  themeColor: '#000000',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl" className={`${vazirmatn.variable} ${lalezar.variable} ${tracingFont.variable} scroll-smooth`}>
      <head>
        <link rel="icon" type="image/png" sizes="192x192" href="/icon-192x192.png" />
        <link rel="icon" type="image/png" sizes="512x512" href="/icon-512x512.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="apple-touch-icon" sizes="192x192" href="/icon-192x192.png" />
        <link rel="apple-touch-icon" sizes="512x512" href="/icon-512x512.png" />
      </head>
      <body suppressHydrationWarning className="font-sans antialiased text-slate-800 bg-slate-50 min-h-screen">
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js');
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
