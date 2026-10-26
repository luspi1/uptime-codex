"use client";

import { useEffect, useState } from "react";
import Avatar from "./Avatar";
import FileUpload from "./FileUpload";
import type { User } from "./auth/api";

interface AvatarUploadProps {
  user: User;
  file?: File;
  disabled?: boolean;
  onChange: (file: File | undefined) => void;
  onError: (message: string) => void;
}

export default function AvatarUpload({ user, file, disabled, onChange, onError }: AvatarUploadProps) {
  const [preview, setPreview] = useState("");

  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div className="avatar-upload">
      <Avatar user={user} preview={preview} large />
      <FileUpload label="Загрузить аватар" files={file ? [file] : []}
        accept="image/png,image/jpeg" disabled={disabled}
        hint="PNG или JPEG, до 5 МБ и 16 мегапикселей. Аватар обновится после сохранения."
        onFilesChange={([selected]) => {
          if (!["image/png", "image/jpeg"].includes(selected.type) || selected.size > 5 * 1024 * 1024) {
            onChange(undefined);
            onError("Выберите PNG или JPEG размером до 5 МБ.");
            return;
          }
          onError("");
          onChange(selected);
        }} />
    </div>
  );
}
