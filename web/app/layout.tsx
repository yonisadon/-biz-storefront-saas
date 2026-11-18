import type { Metadata } from "next";
import "./globals.css";
import GlobalAccessibilityToolbar from "@/components/GlobalAccessibilityToolbar";

export const metadata: Metadata = {
  title: "אתרי מדף לעסקים",
  description: "אתרים עסקיים פשוטים לניהול, עם קישור ייעודי לכל עסק.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}<GlobalAccessibilityToolbar /></body>
    </html>
  );
}
