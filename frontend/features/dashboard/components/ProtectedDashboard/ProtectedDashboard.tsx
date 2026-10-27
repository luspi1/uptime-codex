"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "@/features/auth/components/AuthProvider/AuthProvider";
import DashboardLayout from "../DashboardLayout/DashboardLayout";

export default function ProtectedDashboard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, status, error, retry } = useAuth();

  useEffect(() => {
    if (status === "anonymous") router.replace("/login");
  }, [router, status]);

  if (status === "loading") {
    return <main className="shell"><section className="card" role="status">Проверяем сессию…</section></main>;
  }

  if (status === "error") {
    return (
      <main className="shell">
        <section className="card">
          <p className="eyebrow">Uptime App</p>
          <h1>Не удалось проверить сессию</h1>
          <p className="muted">{error}</p>
          <button className="button" onClick={retry}>Повторить</button>
        </section>
      </main>
    );
  }

  if (status === "anonymous") {
    return <main className="shell"><section className="card" role="status">Открываем страницу входа…</section></main>;
  }

  if (!user) {
    return <main className="shell"><section className="card" role="status">Проверяем сессию…</section></main>;
  }

  return (
    <DashboardLayout user={user}>{children}</DashboardLayout>
  );
}
