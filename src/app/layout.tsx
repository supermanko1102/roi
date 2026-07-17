import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "桃園預售雷達｜成交行情、建案比較與投報試算",
  description: "用實價成交資料搜尋桃園預售建案，比較總價、附近行情與交通，並試算房貸、租金投報與每月現金流。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
