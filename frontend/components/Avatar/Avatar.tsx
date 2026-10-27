export default function Avatar({ name, src, large = false }: { name: string; src?: string; large?: boolean }) {
  return src
    ? <img className={`user-avatar${large ? " large" : ""}`} src={src} alt="Аватар пользователя" width={large ? 80 : 32} height={large ? 80 : 32} />
    : <span className={`user-avatar${large ? " large" : ""}`} aria-hidden="true">{Array.from(name)[0]?.toUpperCase()}</span>;
}
