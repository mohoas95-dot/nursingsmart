import type {Metadata} from 'next';
import { Vazirmatn } from 'next/font/google';
import './globals.css'; // Global styles

const vazirmatn = Vazirmatn({
  subsets: ['arabic', 'latin'],
  variable: '--font-vazirmatn',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'سامانه هوشمند برنامه‌ریزی شیفت پرستاری بیمارستان',
  description: 'سیستم هوشمند تخصیص خودکار و عادلانه شیفت پرسنل با موتور الگوریتمی پیشرفته و هوشمند',
  themeColor: '#000000',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'NursePlan',
  },
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="fa" dir="rtl" className={`${vazirmatn.variable} scroll-smooth`}>
      <head>
        {/* آیکون استاندارد اندروید و مرورگرها */}
        <link rel="icon" type="image/png" sizes="192x192" href="/icon-192x192.png" />
        <link rel="icon" type="image/png" sizes="512x512" href="/icon-512x512.png" />
        
        {/* آیکون‌های اختصاصی دستگاه‌های اپل (iOS) */}
        <link rel="apple-touch-icon" sizes="192x192" href="/icon-192x192.png" />
        <link rel="apple-touch-icon" sizes="512x512" href="/icon-512x512.png" />
      </head>
      <body suppressHydrationWarning className="font-sans antialiased text-slate-800 bg-slate-50 min-h-screen">
        {children}
      </body>
    </html>
  );
}
