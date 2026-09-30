"use client";
import { FormEvent, useRef, useState } from "react";
import { ApiError, apiPost } from "@/lib/api";
import type { PlayerProfile } from "@/lib/types";

interface Props { onCreated: (player: PlayerProfile) => void; onCancel: () => void }

export default function CreatePlayer({ onCreated, onCancel }: Props) {
  const [username, setUsername] = useState("");
  const [department, setDepartment] = useState("");
  const [code, setCode] = useState("");
  const [confirmCode, setConfirmCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usernameRef = useRef<HTMLInputElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (code !== confirmCode) { setError("Player Codes do not match."); return; }
    setBusy(true); setError(null);
    try {
      const { player } = await apiPost<{ player: PlayerProfile }>("/api/player/register", {
        username, playerCode: code, department,
      });
      onCreated(player);
    } catch (err) {
      setBusy(false);
      setError(err instanceof ApiError ? err.message : "Couldn't create your player. Please try again.");
      if (err instanceof ApiError && err.status === 409) usernameRef.current?.focus();
    }
  };

  const ready = username.trim().length >= 2 && code.length >= 4 && confirmCode.length >= 4;

  return (
    <form onSubmit={submit} className="panel drop-in w-full max-w-xl p-6 sm:p-8" aria-labelledby="create-player">
      <h2 id="create-player" className="font-arcade text-center text-[clamp(14px,2.4vw,20px)] neon-yellow">CREATE NEW PLAYER</h2>
      <p className="mt-4 text-center text-[20px] text-[#b8c4ff]">Your scores will be saved under this username.</p>

      <label className="label mt-7 block" htmlFor="new-username">USERNAME</label>
      <input
        id="new-username" ref={usernameRef} autoFocus className="arcade-input mt-2" value={username} maxLength={24}
        autoComplete="username" spellCheck={false} placeholder="CHOOSE A UNIQUE NAME"
        onChange={(e) => { setUsername(e.target.value); setError(null); }}
      />

      <label className="label mt-5 block" htmlFor="new-department">TEAM OR GROUP <span className="text-[#4a5aa8]">(OPTIONAL)</span></label>
      <input
        id="new-department" className="arcade-input mt-2" value={department} maxLength={50}
        autoComplete="organization" placeholder="YOUR TEAM OR GROUP"
        onChange={(e) => { setDepartment(e.target.value); setError(null); }}
      />

      <label className="label mt-5 block" htmlFor="new-code">CREATE PLAYER CODE</label>
      <input
        id="new-code" type="password" className="arcade-input mt-2 tracking-[.3em]" value={code} minLength={4} maxLength={32}
        autoComplete="new-password" placeholder="4+ CHARACTERS"
        onChange={(e) => { setCode(e.target.value); setError(null); }}
      />

      <label className="label mt-5 block" htmlFor="confirm-code">CONFIRM PLAYER CODE</label>
      <input
        id="confirm-code" type="password" className="arcade-input mt-2 tracking-[.3em]" value={confirmCode} minLength={4} maxLength={32}
        autoComplete="new-password" placeholder="ENTER IT AGAIN"
        onChange={(e) => { setConfirmCode(e.target.value); setError(null); }}
      />

      <div className="mt-2 min-h-[54px]" aria-live="polite">
        {error && <p className="font-arcade pt-2 text-[10px] leading-[1.8] neon-red">{error}</p>}
      </div>

      <button type="submit" data-menu-item disabled={!ready || busy} className="arcade-btn primary mt-1">
        {busy ? "CREATING..." : "CREATE & ENTER ARCADE"}
      </button>
      <button type="button" onClick={onCancel} disabled={busy} className="font-arcade mt-5 w-full text-center text-[9px] text-[#5a6bb8] hover:text-white disabled:opacity-40">BACK TO PLAYER LIST</button>
    </form>
  );
}
