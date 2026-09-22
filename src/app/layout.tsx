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
    // Gyazo などのブラウザ拡張が <html> に属性を足すため、
    // この要素だけ hydration の不一致を警告しない。配下の要素には影響しない。
    <html lang="ja" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
