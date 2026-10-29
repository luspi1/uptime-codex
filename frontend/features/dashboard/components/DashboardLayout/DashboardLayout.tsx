"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/features/auth/components/AuthProvider/AuthProvider";
import { avatarSource, type User } from "@/features/auth/api";
import styles from "./DashboardLayout.module.css";
import Avatar from "@/components/Avatar/Avatar";

/** Supplies dashboard navigation; the caller must verify the session before rendering children. */
export default function DashboardLayout({ user, children }: { user: User; children: ReactNode }) {
  const router = useRouter();
  const { logout } = useAuth();
  const profileRef = useRef<HTMLDetailsElement>(null);
  const [logoutError, setLogoutError] = useState("");
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    function closeProfile(event: PointerEvent) {
      if (event.target instanceof Node && !profileRef.current?.contains(event.target)) {
        profileRef.current?.removeAttribute("open");
      }
    }

    document.addEventListener("pointerdown", closeProfile);
    return () => document.removeEventListener("pointerdown", closeProfile);
  }, []);

  async function handleLogout() {
    if (isLoggingOut) return;
    setLogoutError("");
    setIsLoggingOut(true);
    try {
      await logout();
      router.replace("/login");
    } catch {
      setLogoutError("Не удалось выйти. Проверьте соединение и повторите попытку.");
      if (profileRef.current) profileRef.current.open = true;
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <div className={styles.dashboard}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}>Uptime App</Link>
        <nav aria-label="Профиль пользователя">
          <details
            className={styles.profile}
            ref={profileRef}
            onKeyDown={(event) => {
              if (event.key === "Escape" && profileRef.current?.open) {
                profileRef.current.open = false;
                profileRef.current.querySelector("summary")?.focus();
              }
            }}
          >
            <summary className={styles.trigger}>
              <Avatar name={user.name || user.email} src={user.avatar_url ? avatarSource(user.avatar_url) : ""} />
              <span>Профиль</span>
              <span className={styles.chevron} aria-hidden="true">▾</span>
            </summary>
            <div className={styles.dropdown}>
              <p className={styles.label}>Вы вошли как</p>
              {user.name && <p className={styles.name}>{user.name}</p>}
              <p className={styles.email}>{user.email}</p>
              <Link href="/profile" className="button secondary" onClick={() => profileRef.current?.removeAttribute("open")}>
                Мой профиль
              </Link>
              {logoutError && <p className="message error" role="alert">{logoutError}</p>}
              <button className="button secondary" type="button" onClick={handleLogout} disabled={isLoggingOut}>
                {isLoggingOut ? "Выходим…" : "Выйти"}
              </button>
            </div>
          </details>
        </nav>
      </header>
      <main className={styles.content}>{children}</main>
    </div>
  );
}
