import { avatarSource, type User } from "./auth/api";

export default function Avatar({ user, preview, large = false }: { user: User; preview?: string; large?: boolean }) {
  const source = preview || (user.avatar_url ? avatarSource(user.avatar_url) : "");
  return source
    ? <img className={`user-avatar${large ? " large" : ""}`} src={source} alt="Аватар пользователя" width={large ? 80 : 32} height={large ? 80 : 32} />
    : <span className={`user-avatar${large ? " large" : ""}`} aria-hidden="true">{Array.from(user.name || user.email)[0].toUpperCase()}</span>;
}
