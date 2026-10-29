import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AuthProvider } from "@/features/auth/components/AuthProvider/AuthProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Uptime App",
  description: "Личный кабинет Uptime App",
};

/** Keeps a single session provider mounted across navigation so routes share auth state. */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body><AuthProvider>{children}</AuthProvider></body>
    </html>
  );
}
