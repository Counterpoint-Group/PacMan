"use client";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import type { PlayerProfile, PublicPlayer } from "@/lib/types";
import { ArcadeButton, PacLoader } from "./ui";
import CreatePlayer from "./CreatePlayer";

interface Props { onVerified: (p: PlayerProfile) => void; onBack?: () => void }

export default function PlayerSelector({ onVerified, onBack }: Props) {
  const [players, setPlayers] = useState<PublicPlayer[] | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<PublicPlayer | null>(null);
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "verified">("idle");
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setPlayers(null); setLoadError(null);
    apiGet<{ players: PublicPlayer[] }>("/api/players").then((r) => setPlayers(r.players)).catch((e: ApiError) => setLoadError(e.message));
  }, []);
  useEffect(load, [load]);
  useEffect(() => { if (players && !isCreating) searchRef.current?.focus(); }, [players, isCreating]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!players) return [];
    return q ? players.filter((p) => p.name.toLowerCase().includes(q) || (p.department ?? "").toLowerCase().includes(q)) : players;
  }, [players, query]);

  const choose = (p: PublicPlayer) => { setSelected(p); setError(null); setTimeout(() => codeRef.current?.focus(), 0); };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!selected || !code || status === "checking") return;
    setStatus("checking"); setError(null);
    try {
      const { player } = await apiPost<{ player: PlayerProfile }>("/api/player/verify", { playerId: selected.id, playerCode: code });
      setStatus("verified");
      setTimeout(() => onVerified(player), 900);
    } catch (err) {
      setStatus("idle"); setCode("");
      setError(err instanceof ApiError ? err.message : "Incorrect Player Code. Please try again.");
      codeRef.current?.focus();
    }
  };

  if (loadError) {
    return (
      <div className="panel drop-in w-full max-w-md p-8 text-center">
        <p className="font-arcade text-[12px] neon-red">CAN&apos;T LOAD PLAYERS</p>
        <p className="mt-4 text-[#b8c4ff]">{loadError}</p>
        <div className="mt-6"><ArcadeButton onClick={load} variant="primary">TRY AGAIN</ArcadeButton></div>
      </div>
    );
  }
  if (!players) return <PacLoader label="LOADING PLAYERS..." />;
  if (isCreating) return <CreatePlayer onCreated={onVerified} onCancel={() => setIsCreating(false)} />;

  return (
    <form onSubmit={submit} className="panel drop-in w-full max-w-xl p-6 sm:p-8" aria-labelledby="who">
      <h2 id="who" className="font-arcade text-center text-[clamp(16px,2.4vw,22px)] neon-yellow">WHO&apos;S PLAYING?</h2>

      <label className="label mt-7 block" htmlFor="search">PLAYER</label>
      <input
        id="search" ref={searchRef} className="arcade-input mt-2" value={query} autoComplete="off" spellCheck={false}
        placeholder="SEARCH NAME OR DEPARTMENT" onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && matches.length >= 1) { e.preventDefault(); choose(matches[0]); }
          if (e.key === "ArrowDown") { e.preventDefault(); (e.currentTarget.form?.querySelector("[data-player]") as HTMLElement | null)?.focus(); }
        }}
      />

      <ul role="listbox" aria-label="Players" className="mt-2 max-h-56 overflow-y-auto border-[3px] border-[#1c2a78] bg-[#02030a]">
        <li className="border-b-2 border-[var(--pac)]">
          <button
            type="button" data-player onClick={() => setIsCreating(true)}
            className="flex w-full items-center gap-3 bg-[#241f00] px-4 py-3 text-left text-[var(--pac)] hover:bg-[#3a3200] focus-visible:bg-[#3a3200] focus-visible:outline-none"
          >
            <span className="font-arcade text-[16px]">+</span>
            <span className="font-arcade text-[11px]">NEW PLAYER — CREATE ACCOUNT</span>
          </button>
        </li>
        {matches.length === 0 && <li className="p-4 text-[#7f95ff]">No player matches &quot;{query}&quot;.</li>}
        {matches.map((p) => {
          const on = selected?.id === p.id;
          return (
            <li key={p.id} role="option" aria-selected={on}>
              <button
                type="button" data-player onClick={() => choose(p)}
                onKeyDown={(e) => {
                  const btn = e.currentTarget;
                  if (e.key === "ArrowDown") { e.preventDefault(); (btn.parentElement?.nextElementSibling?.querySelector("button") as HTMLElement | null)?.focus(); }
                  if (e.key === "ArrowUp") { e.preventDefault(); const prev = btn.parentElement?.previousElementSibling?.querySelector("button") as HTMLElement | null; (prev ?? searchRef.current)?.focus(); }
                }}
                className={`flex w-full items-baseline justify-between gap-4 px-4 py-2.5 text-left hover:bg-[#0b1550] focus-visible:bg-[#0b1550] focus-visible:outline-none ${on ? "bg-[#14206e] text-[var(--pac)]" : ""}`}
              >
                <span className="font-arcade text-[11px]">{p.name}</span>
                <span className="text-[18px] text-[#7f95ff]">{p.department ?? ""}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <label className="label mt-6 block" htmlFor="code">PLAYER CODE{selected ? ` — ${selected.name.toUpperCase()}` : ""}</label>
      <input
        id="code" ref={codeRef} type="password" inputMode="text" autoComplete="off" maxLength={32} value={code} disabled={!selected || status !== "idle"}
        className="arcade-input mt-2 tracking-[.4em] disabled:opacity-40" placeholder={selected ? "••••" : "SELECT A PLAYER FIRST"}
        onChange={(e) => { setCode(e.target.value); setError(null); }}
      />

      <div className="mt-2 min-h-[54px]" aria-live="polite">
        {error && <p className="font-arcade pt-2 text-[10px] leading-[1.8] neon-red">{error.split(". ").map((s, i, a) => <span key={i} className="block">{s}{i < a.length - 1 && !s.endsWith(".") ? "." : ""}</span>)}</p>}
        {status === "verified" && <p className="font-arcade pt-2 text-[12px] neon-green">PLAYER VERIFIED</p>}
      </div>

      <button type="submit" data-menu-item disabled={!selected || !code || status !== "idle"} className="arcade-btn primary mt-1">
        {status === "checking" ? "CHECKING..." : "ENTER ARCADE"}
      </button>
      {onBack && <button type="button" onClick={onBack} className="font-arcade mt-5 w-full text-center text-[9px] text-[#5a6bb8] hover:text-white">BACK</button>}
    </form>
  );
}
