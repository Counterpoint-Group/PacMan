"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiGet } from "@/lib/api";
import type { LeaderboardEntry, LeaderboardFilter, LeaderboardResponse } from "@/lib/types";
import { ArcadeButton, DIFF_COLOR, PacLoader, fmt } from "./ui";

const TABS: { key: LeaderboardFilter; label: string }[] = [
  { key: "OVERALL", label: "OVERALL" }, { key: "EASY", label: "EASY" }, { key: "OK_OK", label: "OK OK" },
  { key: "NIGHTMARE", label: "NIGHTMARE" }, { key: "LEVEL", label: "HIGHEST LEVEL" },
];
const MEDAL = ["🥇", "🥈", "🥉"];
const COLS = "grid-cols-[56px_minmax(0,1fr)_112px_72px_72px_80px_80px_110px] md:grid-cols-[64px_minmax(0,1.3fr)_minmax(0,1fr)_128px_96px_96px_96px_124px]";

function Row({ e, me, sticky = false }: { e: LeaderboardEntry; me: boolean; sticky?: boolean }) {
  return (
    <div className={`grid ${COLS} items-center gap-3 px-3 py-2.5 ${me ? "border-2 border-[var(--pac)] bg-[#241f00] text-[var(--pac)]" : "border-b border-[#101a52]"} ${sticky ? "mt-3" : ""}`} aria-current={me ? "true" : undefined}>
      <span className="font-arcade text-[12px]">{e.rank <= 3 ? MEDAL[e.rank - 1] : `#${e.rank}`}</span>
      <span className="font-arcade truncate text-[11px]">{e.name}</span>
      <span className="hidden truncate text-[#7f95ff] md:block">{e.department ?? ""}</span>
      <span className="font-arcade text-right text-[11px]">{fmt(e.highScore)}</span>
      <span className="font-arcade text-right text-[10px]">LEVEL {e.highestLevel || "—"}</span>
      <span className="font-arcade text-right text-[10px]">{fmt(e.ghostsEaten)}</span>
      <span className="font-arcade text-right text-[10px]">{fmt(e.pelletsEaten)}</span>
      <span className={`font-arcade text-right text-[9px] ${e.bestDifficulty ? DIFF_COLOR[e.bestDifficulty] : ""}`}>{e.bestDifficulty ?? "—"}</span>
    </div>
  );
}

export default function Leaderboard({ playerId, onBack }: { playerId: string; onBack: () => void }) {
  const [filter, setFilter] = useState<LeaderboardFilter>("OVERALL");
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const backRef = useRef<HTMLButtonElement>(null);

  const load = useCallback((f: LeaderboardFilter) => {
    setData(null); setError(null);
    apiGet<LeaderboardResponse>(`/api/leaderboard?filter=${f}`).then(setData).catch((e: ApiError) => setError(e.message));
  }, []);
  useEffect(() => load(filter), [filter, load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onBack(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  const meVisible = !!data?.entries.some((e) => e.playerId === playerId);

  return (
    <div className="w-full max-w-5xl overflow-hidden">
      <h2 className="font-arcade text-center text-[clamp(14px,2.4vw,24px)] neon-yellow">COUNTERPOINT LEADERBOARD</h2>

      <div role="tablist" aria-label="Leaderboard filter" className="sticky top-0 z-10 mt-7 flex flex-wrap justify-center gap-2 border-b border-[#1c2a78] bg-[#02030a] pb-3 pt-1">
        {TABS.map((t) => <button key={t.key} role="tab" type="button" className="tab" aria-selected={filter === t.key} onClick={() => setFilter(t.key)}>{t.label}</button>)}
      </div>

      <div className="panel mt-6 p-3 sm:p-5">
        <div className={`grid ${COLS} gap-3 border-b-2 border-[#1c2a78] px-3 pb-3`}>
          <span className="label">RANK</span><span className="label">PLAYER</span><span className="label hidden md:block">DEPARTMENT</span>
          <span className="label text-right">HIGH SCORE</span><span className="label text-right">LEVEL</span><span className="label text-right">GHOSTS</span>
          <span className="label text-right">PELLETS</span><span className="label text-right">DIFFICULTY</span>
        </div>

        <div className="max-h-[52vh] min-h-[220px] overflow-y-auto">
          {error && (
            <div className="py-10 text-center">
              <p className="font-arcade text-[11px] neon-red">CAN&apos;T LOAD SCORES</p>
              <p className="mt-3 text-[#b8c4ff]">{error}</p>
              <div className="mx-auto mt-5 max-w-[200px]"><ArcadeButton compact onClick={() => load(filter)}>TRY AGAIN</ArcadeButton></div>
            </div>
          )}
          {!error && !data && <div className="flex justify-center py-12"><PacLoader label="LOADING SCORES..." /></div>}
          {data && data.entries.length === 0 && (
            <p className="py-12 text-center text-[24px] text-[#8ea6ff]">No scores here yet. Play a game and take the first spot.</p>
          )}
          {data?.entries.map((e) => <Row key={e.playerId} e={e} me={e.playerId === playerId} />)}
        </div>

        {data?.me && !meVisible && (
          <div>
            <p className="font-arcade mt-4 text-center text-[11px] neon-yellow">YOUR RANK #{data.me.rank}</p>
            <Row e={data.me} me sticky />
          </div>
        )}
        {data && !data.me && data.entries.length > 0 && <p className="mt-4 text-center text-[#7f95ff]">You&apos;re not on this board yet.</p>}
      </div>

      <div className="mx-auto mt-6 max-w-[220px]"><button ref={backRef} type="button" data-menu-item className="arcade-btn compact" onClick={onBack}>BACK</button></div>
    </div>
  );
}
