import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "房市探探｜北北桃預售與租賃實價登錄",
  description: "用地圖與棟別圖探北北桃預售屋成交行情，以及屋齡 1–10 年的租賃實價登錄。",
  icons: {
    icon: "/brand/fangshi-tantan-logo-192.png",
    apple: "/brand/fangshi-tantan-logo-192.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant" className="font-sans">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
