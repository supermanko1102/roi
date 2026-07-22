import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "預售探探｜北北桃預售實價登錄",
  description: "用地圖與棟別圖探北北桃預售屋成交行情，以及屋齡 1–10 年的租賃實價登錄。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant" className="font-sans">
      <body>{children}</body>
    </html>
  );
}
