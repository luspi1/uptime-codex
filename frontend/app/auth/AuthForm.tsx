"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "./AuthProvider";
import type { AuthMode } from "./api";

const errorMessages: Record<string, string> = {
  email_taken: "Этот email уже зарегистрирован.",
  invalid_credentials: "Неверный email или пароль.",
  invalid_request: "Проверьте email и пароль. Длина пароля — от 8 до 72 байт.",
  origin_not_allowed: "Адрес приложения не разрешён на сервере.",
  network_error: "Не удалось связаться с сервером. Повторите попытку позже.",
};

export default function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const { status, error: sessionError, retry, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isRegister = mode === "register";

  useEffect(() => {
    if (status === "authenticated") router.replace("/");
  }, [router, status]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const passwordBytes = new TextEncoder().encode(password).length;
    if (passwordBytes < 8 || passwordBytes > 72) {
      setError("Длина пароля должна быть от 8 до 72 байт.");
      return;
    }
    setIsSubmitting(true);
    try {
      await login(mode, email.trim(), password);
      router.replace("/");
    } catch (failure: unknown) {
      const code = failure instanceof Error && "code" in failure && typeof failure.code === "string" ? failure.code : "unknown_error";
      setError(errorMessages[code] || "Не удалось выполнить запрос. Повторите попытку.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (status === "loading") {
    return <main className="shell"><section className="card" role="status">Проверяем сессию…</section></main>;
  }

  if (status === "authenticated") {
    return <main className="shell"><section className="card" role="status">Открываем личную страницу…</section></main>;
  }

  return (
    <main className="shell">
      <section className="card">
        <p className="eyebrow">Uptime App</p>
        <h1>{isRegister ? "Создать аккаунт" : "Войти в аккаунт"}</h1>
        <p className="muted">{isRegister ? "Зарегистрируйтесь, чтобы открыть личную страницу." : "Введите данные своего аккаунта."}</p>
        {status === "error" && (
          <div className="message error" role="alert">
            {sessionError} <button className="text-button" type="button" onClick={retry}>Повторить проверку</button>
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} />
          <label htmlFor="password">Пароль</label>
          <input id="password" type="password" autoComplete={isRegister ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} required />
          {isRegister && <p className="hint">От 8 до 72 байт.</p>}
          {error && <p className="message error" role="alert">{error}</p>}
          <button className="button full-width" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Подождите…" : isRegister ? "Зарегистрироваться" : "Войти"}
          </button>
        </form>
        <p className="switch-link">
          {isRegister ? "Уже есть аккаунт? " : "Нет аккаунта? "}
          <Link href={isRegister ? "/login" : "/register"}>{isRegister ? "Войти" : "Зарегистрироваться"}</Link>
        </p>
      </section>
    </main>
  );
}
