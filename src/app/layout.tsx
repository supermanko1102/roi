import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "桃園預售屋投報率地圖",
  description: "實價登錄預售價 × 租賃行情推估投報率",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
