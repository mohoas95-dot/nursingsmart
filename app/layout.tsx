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
  manifest: '/manifest.json',
  themeColor: '#000000',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'NursePlan',
  },
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="fa" dir="rtl" className={`${vazirmatn.variable} scroll-smooth`}>
      <body suppressHydrationWarning className="font-sans antialiased text-slate-800 bg-slate-50 min-h-screen">
        {children}
      </body>
    </html>
  );
}
