import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "清掃予約管理",
  description: "原状回復清掃の依頼受付・配車・進捗管理",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
