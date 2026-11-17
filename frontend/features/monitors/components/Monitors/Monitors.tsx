"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthError, createMonitor, deleteMonitor, listMonitors, updateMonitor, type Monitor } from "@/features/auth/api";
import styles from "./Monitors.module.css";

/** Manages the current user's monitors inside the protected dashboard. */
export default function Monitors() {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const [editing, setEditing] = useState<Monitor | null>(null);
  const [deleting, setDeleting] = useState<Monitor | null>(null);
  // A ref blocks duplicate submissions before the saving state reaches the next render.
  const submitting = useRef(false);
  const [items, setItems] = useState<Monitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [url, setUrl] = useState("");
  const [interval, setInterval] = useState("5");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    listMonitors().then((data) => { if (active) setItems(data); }).catch((failure: unknown) => {
      if (!active) return;
      if (failure instanceof AuthError && failure.status === 401) router.replace("/login");
      else setLoadError("Не удалось загрузить сайты. Повторите попытку.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt, router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    setError("");
    let parsed: URL;
    try { parsed = new URL(url.trim()); } catch {
      setError("Введите полный URL, например https://example.com.");
      return;
    }
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) {
      setError("Укажите HTTP или HTTPS URL без логина, пароля и фрагмента (#).");
      return;
    }
    const minutes = Number(interval);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
      setError("Частота опроса должна быть целым числом от 1 до 1440 минут.");
      return;
    }
    submitting.current = true;
    setSaving(true);
    try {
      const input = { url: url.trim(), interval_minutes: minutes };
      const item = editing ? await updateMonitor(editing.id, input) : await createMonitor(input);
      setItems((current) => editing ? current.map((stored) => stored.id === item.id ? item : stored) : [item, ...current]);
      dialog.current?.close();
      setNotice(editing ? "Изменения сохранены." : "Точка мониторинга создана.");
    } catch (failure: unknown) {
      if (failure instanceof AuthError && failure.status === 401) {
        dialog.current?.close();
        router.replace("/login");
      } else if (editing && failure instanceof AuthError && failure.status === 404) {
        setItems((current) => current.filter((item) => item.id !== editing.id));
        dialog.current?.close();
        setNotice("Сайт уже удалён. Список обновлён.");
      } else setError(editing
        ? "Не удалось сохранить изменения. Проверьте URL и соединение, затем повторите попытку."
        : "Не удалось создать точку мониторинга. Проверьте URL и соединение, затем повторите попытку.");
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleting || submitting.current) return;
    submitting.current = true;
    setSaving(true);
    setError("");
    try {
      await deleteMonitor(deleting.id);
      setItems((current) => current.filter((item) => item.id !== deleting.id));
      deleteDialog.current?.close();
      setNotice("Сайт удалён.");
    } catch (failure: unknown) {
      if (failure instanceof AuthError && failure.status === 401) {
        deleteDialog.current?.close();
        router.replace("/login");
      } else if (failure instanceof AuthError && failure.status === 404) {
        setItems((current) => current.filter((item) => item.id !== deleting.id));
        deleteDialog.current?.close();
        setNotice("Сайт уже удалён. Список обновлён.");
      } else setError("Не удалось удалить сайт. Проверьте соединение и повторите попытку.");
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  return (
    <section>
      <div className={styles.heading}>
        <div><h1>Мои сайты</h1><p className="muted">Точки мониторинга ваших сайтов</p></div>
        <button className="button" disabled={loading || !!loadError} onClick={() => {
          setEditing(null); setUrl(""); setInterval("5"); setError(""); setNotice(""); dialog.current?.showModal();
        }}>Добавить сайт</button>
      </div>
      {notice && <p role="status">{notice}</p>}
      {loading ? <p role="status">Загружаем сайты…</p> : loadError ? (
        <div role="alert"><p>{loadError}</p><button className="button secondary" onClick={() => setAttempt((value) => value + 1)}>Повторить</button></div>
      ) : items.length === 0 ? <p className="muted">Пока нет сайтов. Добавьте первый сайт для мониторинга.</p> : (
        <ul className={styles.list} aria-label="Точки мониторинга">
          {items.map((item) => <li key={item.id} className={styles.item}>
            <p className={styles.url}>{item.url}</p>
            <p className="muted">Частота опроса: {item.interval_minutes} мин.</p>
            <span className={styles.status}>Ещё не проверялся</span>
            <div className={styles.actions}>
              <button className="button secondary" onClick={() => {
                setEditing(item); setUrl(item.url); setInterval(String(item.interval_minutes));
                setError(""); setNotice(""); dialog.current?.showModal();
              }}>Редактировать</button>
              <button className={`button secondary ${styles.danger}`} onClick={() => {
                setDeleting(item); setError(""); setNotice(""); deleteDialog.current?.showModal();
              }}>Удалить</button>
            </div>
          </li>)}
        </ul>
      )}
      <dialog ref={dialog} className={styles.dialog} aria-labelledby="site-form-title" onCancel={(event) => { if (submitting.current) event.preventDefault(); }}>
        <h2 id="site-form-title">{editing ? "Редактировать сайт" : "Добавить сайт"}</h2>
        <form onSubmit={submit}>
          <label htmlFor="monitor-url">URL сайта</label>
          <input id="monitor-url" type="url" required maxLength={2048} placeholder="https://example.com" autoFocus value={url} onChange={(event) => setUrl(event.target.value)} disabled={saving} />
          <label htmlFor="monitor-interval">Частота опроса (минуты)</label>
          <input id="monitor-interval" type="number" required min={1} max={1440} step={1} value={interval} onChange={(event) => setInterval(event.target.value)} disabled={saving} aria-describedby="interval-hint" />
          <p id="interval-hint" className="hint">От 1 до 1440 минут</p>
          {error && <p role="alert" className="message error">{error}</p>}
          <div className={styles.actions}>
            <button type="button" className="button secondary" disabled={saving} onClick={() => dialog.current?.close()}>Отмена</button>
            <button type="submit" className="button" disabled={saving}>{editing ? (saving ? "Сохраняем…" : "Сохранить") : (saving ? "Создаём…" : "Создать")}</button>
          </div>
        </form>
      </dialog>
      <dialog ref={deleteDialog} className={styles.dialog} aria-labelledby="delete-site-title" aria-describedby="delete-site-description" onCancel={(event) => { if (submitting.current) event.preventDefault(); }}>
        <h2 id="delete-site-title">Удалить сайт?</h2>
        <p id="delete-site-description">Сайт <strong className={styles.url}>{deleting?.url}</strong> будет удалён из мониторинга. Это действие нельзя отменить.</p>
        {error && <p role="alert" className="message error">{error}</p>}
        <div className={styles.actions}>
          <button type="button" autoFocus className="button secondary" disabled={saving} onClick={() => deleteDialog.current?.close()}>Отмена</button>
          <button type="button" className={`button ${styles.danger}`} disabled={saving} onClick={confirmDelete}>{saving ? "Удаляем…" : "Удалить"}</button>
        </div>
      </dialog>
    </section>
  );
}
