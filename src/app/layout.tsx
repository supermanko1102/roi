import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "桃園預售雷達｜預售與租賃實價登錄",
  description: "用地圖與列表瀏覽桃園預售屋成交，以及屋齡 1–10 年的租賃實價登錄。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant" className="font-sans">
      <body>{children}</body>
    </html>
  );
}
