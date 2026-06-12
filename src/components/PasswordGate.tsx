"use client";

import { useEffect, useRef, useState } from "react";
import { getPassword, setPassword } from "@/lib/agentClient";

type Props = {
  open: boolean;
  onClose: () => void;
  onSubmit: (password: string) => void;
};

export function PasswordPrompt({ open, onClose, onSubmit }: Props) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(getPassword() ?? "");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  if (!open) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    setPassword(trimmed);
    onSubmit(trimmed);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-xl border border-border bg-white p-5 space-y-3 shadow-lg"
      >
        <h2 className="text-lg font-semibold">Password required</h2>
        <p className="text-sm text-muted">
          Live agent runs are gated by a shared password. Ask the site owner if
          you don&apos;t have it. Cached reports are visible without a password.
        </p>
        <input
          ref={inputRef}
          type="password"
          autoComplete="off"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="paste password"
          className="w-full font-mono rounded-md border border-border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-3 rounded-md border border-border hover:bg-slate-50 text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!draft.trim()}
            className="h-9 px-3 rounded-md bg-accent text-accent-fg font-medium hover:opacity-90 disabled:opacity-50 text-sm"
          >
            Save & continue
          </button>
        </div>
      </form>
    </div>
  );
}
