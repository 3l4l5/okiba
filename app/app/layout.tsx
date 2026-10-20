// 基盤ファイル。html と body だけ。認証は middleware と ALB が行う。
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "okiba",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
