"use client";

import { useEffect, useState } from "react";
import Avatar from "@/components/Avatar/Avatar";
import FileUpload from "@/components/FileUpload/FileUpload";
import { avatarSource, type User } from "@/features/auth/api";

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
      <Avatar name={user.name || user.email} src={preview || (user.avatar_url ? avatarSource(user.avatar_url) : "")} large />
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
