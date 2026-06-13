"use client";

import { useEffect, useRef, useState } from "react";
import { REQUEST_PASSWORD_EVENT_NAME, setPassword } from "@/lib/agentClient";

type Pending = {
  reason: "missing" | "rejected";
  resolve: (password: string | null) => void;
};

/**
 * Single, app-wide password modal. Mount once at the layout root.
 * Listens for `requestPassword()` events dispatched by agentClient and
 * resolves the awaiting promise when the user submits or cancels.
 */
export function PasswordPromptHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    function onRequest(e: Event) {
      const ev = e as CustomEvent<Pending>;
      setDraft("");
      setPending(ev.detail);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
    window.addEventListener(REQUEST_PASSWORD_EVENT_NAME, onRequest);
    return () =>
      window.removeEventListener(REQUEST_PASSWORD_EVENT_NAME, onRequest);
  }, []);

  if (!pending) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    setPassword(trimmed);
    pending?.resolve(trimmed);
    setPending(null);
  }

  function cancel() {
    pending?.resolve(null);
    setPending(null);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-xl border border-border bg-white p-5 space-y-3 shadow-lg"
      >
        <h2 className="text-lg font-semibold">
          {pending.reason === "rejected"
            ? "Password not accepted"
            : "Password required"}
        </h2>
        <p className="text-sm text-muted">
          {pending.reason === "rejected"
            ? "The previous password was rejected. Enter the current shared password to continue."
            : "Live agent runs and portfolio edits are gated by a shared password. Cached reports are visible without one."}
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
            onClick={cancel}
            className="h-9 px-3 rounded-md border border-border hover:bg-slate-50 text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!draft.trim()}
            className="h-9 px-3 rounded-md bg-accent text-accent-fg font-medium hover:opacity-90 disabled:opacity-50 text-sm"
          >
            Continue
          </button>
        </div>
      </form>
    </div>
  );
}

// Legacy alias for any callers still importing PasswordPrompt; new code should
// not need to mount its own modal.
export const PasswordPrompt = (props: {
  open: boolean;
  onClose: () => void;
  onSubmit: (password: string) => void;
}) => {
  // The new architecture renders the modal centrally via PasswordPromptHost.
  // This shim exists only so older imports don't crash; they're now no-ops.
  void props;
  return null;
};
