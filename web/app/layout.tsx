import type { Metadata } from "next";
import "./globals.css";
import AccessibilityToolbar from "@/components/AccessibilityToolbar";

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
      <body>{children}<AccessibilityToolbar statementHref="/platform-legal#accessibility_statement" /></body>
    </html>
  );
}
