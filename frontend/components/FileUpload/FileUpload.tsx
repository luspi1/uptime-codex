"use client";

import { useId, useRef } from "react";

export interface FileUploadProps {
  label: string;
  files: readonly File[];
  onFilesChange: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  hint?: string;
}

/** Delegates file state and validation to the caller; cancelling the picker preserves selection. */
export default function FileUpload({ label, files, onFilesChange, accept, multiple = false, disabled = false, hint }: FileUploadProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);

  return (
    <div className="file-upload">
      <input ref={input} id={id} type="file" hidden aria-label={label}
        accept={accept} multiple={multiple} disabled={disabled}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => {
          const selected = Array.from(event.currentTarget.files ?? []);
          // Reset so choosing the same file again still fires change after validation fails.
          event.currentTarget.value = "";
          if (selected.length) onFilesChange(selected);
        }} />
      <button className="button secondary file-upload-button" type="button" disabled={disabled}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onClick={() => input.current?.click()}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 16V3m-5 5 5-5 5 5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
        </svg>
        {label}
      </button>
      <p className="file-upload-selection hint" aria-live="polite">
        {files.length ? files.map((file) => file.name).join(", ") : multiple ? "Файлы не выбраны" : "Файл не выбран"}
      </p>
      {hint && <p id={`${id}-hint`} className="hint">{hint}</p>}
    </div>
  );
}
