import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/src/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "okiba",
  description: "社内ツールの置き場",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return (
    <html lang="ja">
      <body>
        <header className="site">
          <Link href="/" className="brand">
            okiba
          </Link>
          <span className="user">{user ? user.email : "未ログイン"}</span>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
