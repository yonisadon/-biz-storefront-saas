import type { Metadata } from "next";
import "./globals.css";
import GlobalAccessibilityToolbar from "@/components/GlobalAccessibilityToolbar";

export const metadata: Metadata = {
  title: "BTime — נוכחות דיגיטלית וניהול פשוט לעסק",
  description: "אתר עסקי, הצגת מוצרים ושירותים, פניות וניהול תורים — במקום אחד.",
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
