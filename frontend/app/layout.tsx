import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AuthProvider } from "./auth/AuthProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Uptime App",
  description: "Личный кабинет Uptime App",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body><AuthProvider>{children}</AuthProvider></body>
    </html>
  );
}
