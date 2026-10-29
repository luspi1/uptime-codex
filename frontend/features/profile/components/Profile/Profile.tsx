"use client";

import { useState, type SubmitEvent } from "react";
import ProtectedDashboard from "@/features/dashboard/components/ProtectedDashboard/ProtectedDashboard";
import { useAuth } from "@/features/auth/components/AuthProvider/AuthProvider";
import { AuthError, type User } from "@/features/auth/api";
import AvatarUpload from "../AvatarUpload/AvatarUpload";

function ProfileForm({ user }: { user: User }) {
  const { saveProfile } = useAuth();
  const [name, setName] = useState(user.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [avatar, setAvatar] = useState<File>();
  const trimmedName = name.trim();
  const validName = Array.from(trimmedName).length >= 1 && Array.from(trimmedName).length <= 100;

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setError("");
    setSaved(false);
    // Accounts start with an empty name; allow an avatar-only update without requiring a rename.
    if (!validName && !(avatar && trimmedName === user.name)) {
      setError("Имя должно содержать от 1 до 100 символов.");
      return;
    }
    setSaving(true);
    try {
      await saveProfile(trimmedName, avatar);
      setName(trimmedName);
      setAvatar(undefined);
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
        <AvatarUpload user={user} file={avatar} disabled={saving} onError={setError}
          onChange={(file) => {
            setSaved(false);
            setError("");
            setAvatar(file);
          }} />
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

/** Guards profile editing and resets form state when the authenticated user ID changes. */
export default function Profile() {
  const { user } = useAuth();
  return <ProtectedDashboard>{user && <ProfileForm key={user.id} user={user} />}</ProtectedDashboard>;
}
