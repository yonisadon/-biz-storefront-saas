import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "אתרי מדף לעסקים",
  description: "אתרים עסקיים פשוטים לניהול, עם קישור ייעודי לכל עסק.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "אתרי מדף" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
