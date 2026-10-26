"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import ProtectedDashboard from "../ProtectedDashboard";
import { useAuth } from "../auth/AuthProvider";
import { AuthError, type User } from "../auth/api";
import Avatar from "../Avatar";

function ProfileForm({ user }: { user: User }) {
  const { saveProfile } = useAuth();
  const [name, setName] = useState(user.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [avatar, setAvatar] = useState<File>();
  const [preview, setPreview] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!avatar) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(avatar);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [avatar]);
  const trimmedName = name.trim();
  const validName = Array.from(trimmedName).length >= 1 && Array.from(trimmedName).length <= 100;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setError("");
    setSaved(false);
    if (!validName && !(avatar && trimmedName === user.name)) {
      setError("Имя должно содержать от 1 до 100 символов.");
      return;
    }
    setSaving(true);
    try {
      await saveProfile(trimmedName, avatar);
      setName(trimmedName);
      setAvatar(undefined);
      if (fileInput.current) fileInput.current.value = "";
      setSaved(true);
    } catch (failure: unknown) {
      setError(failure instanceof AuthError && failure.code === "avatar_too_large"
        ? "Аватар должен быть не больше 5 МБ."
        : failure instanceof AuthError && failure.code === "invalid_avatar"
        ? "Выберите корректное изображение PNG или JPEG до 16 мегапикселей."
        : failure instanceof AuthError && failure.code === "invalid_request"
        ? "Имя должно содержать от 1 до 100 символов."
        : "Не удалось сохранить профиль. Проверьте соединение и повторите попытку.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card" aria-labelledby="profile-title">
      <h1 id="profile-title">Мой профиль</h1>
      <form onSubmit={handleSubmit}>
        <Avatar user={user} preview={preview} large />
        <label htmlFor="profile-avatar">Загрузить аватар</label>
        <input ref={fileInput} id="profile-avatar" type="file" accept="image/png,image/jpeg" disabled={saving}
          aria-describedby="avatar-hint" onChange={(event) => {
            const file = event.target.files?.[0];
            setSaved(false);
            setError("");
            if (file && (!["image/png", "image/jpeg"].includes(file.type) || file.size > 5 * 1024 * 1024)) {
              setError("Выберите PNG или JPEG размером до 5 МБ.");
              event.target.value = "";
              setAvatar(undefined);
              return;
            }
            setAvatar(file);
          }} />
        <p id="avatar-hint" className="hint">PNG или JPEG, до 5 МБ и 16 мегапикселей. Аватар обновится после сохранения.</p>
        <label htmlFor="profile-email">Email</label>
        <input id="profile-email" type="email" value={user.email} readOnly />
        <label htmlFor="profile-name">Имя пользователя</label>
        <input id="profile-name" name="name" autoComplete="name" value={name} required={!(avatar && trimmedName === user.name)}
          disabled={saving} aria-describedby="name-hint" onChange={(event) => {
            setName(event.target.value);
            setSaved(false);
            setError("");
          }} />
        <p id="name-hint" className="hint">От 1 до 100 символов.</p>
        {error && <p className="message error" role="alert">{error}</p>}
        {saved && <p className="message" role="status">Профиль сохранён.</p>}
        <button className="button full-width" type="submit" disabled={saving || (validName && trimmedName === user.name && !avatar)}>
          {saving ? "Сохраняем…" : "Сохранить"}
        </button>
      </form>
    </section>
  );
}

export default function ProfilePage() {
  const { user } = useAuth();
  return <ProtectedDashboard>{user && <ProfileForm key={user.id} user={user} />}</ProtectedDashboard>;
}
