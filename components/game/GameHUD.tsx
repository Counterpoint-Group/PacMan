"use client";
import { Pause, Volume2, VolumeX } from "lucide-react";
import type { HudState } from "@/game/engine";
import { DIFFICULTIES, keyFromLabel } from "@/game/difficulty";
import { FRUITS } from "@/game/fruit";
import { DIFF_COLOR, PacIcon, fmt } from "../arcade/ui";

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="label">{label}</div><div className="mt-2">{children}</div></div>;
}
const Lives = ({ n }: { n: number }) => (
  <div className="flex min-h-[22px] flex-wrap gap-1.5" aria-label={`${n} ${n === 1 ? "life" : "lives"}`}>
    {Array.from({ length: n }).map((_, i) => <PacIcon key={i} size={20} />)}
  </div>
);

export function HudLeft({ hud }: { hud: HudState }) {
  return (
    <aside className="hidden w-[210px] shrink-0 flex-col gap-8 p-5 md:flex lg:w-[250px]">
      <Item label="PLAYER"><div className="font-arcade break-words text-[13px] neon-blue">{hud.playerName}</div></Item>
      <Item label="SCORE"><div className="font-arcade text-[20px] text-white">{fmt(hud.score)}</div></Item>
      <Item label="HIGH"><div className="font-arcade text-[14px] neon-yellow">{fmt(hud.highScore)}</div></Item>
    </aside>
  );
}

export function HudRight({ hud, muted, onMute, onPause }: { hud: HudState; muted: boolean; onMute: () => void; onPause: () => void }) {
  const fruit = FRUITS[hud.fruit];
  return (
    <aside className="hidden w-[210px] shrink-0 flex-col gap-8 p-5 md:flex lg:w-[250px]">
      <Item label="LEVEL"><div className="font-arcade text-[20px] text-white">{hud.level}</div><div className="mt-2 text-[18px] text-[#7f95ff]">{hud.mazeName}</div></Item>
      <Item label="MODE"><div className={`font-arcade text-[13px] ${DIFF_COLOR[hud.difficulty]}`}>{hud.difficulty}</div><div className="font-arcade mt-2 text-[9px] text-[#7f95ff]">SCORE ×{DIFFICULTIES[keyFromLabel(hud.difficulty)].scoreMultiplier}</div></Item>
      <Item label="LIVES"><Lives n={hud.lives} /></Item>
      <Item label="FRUIT"><div className="text-[22px]">{fruit.emoji} <span className="font-arcade text-[10px] text-[#b8c4ff]">{fruit.points}</span></div></Item>
      <div className="mt-auto flex gap-3">
        <button type="button" tabIndex={-1} onClick={onPause} className="tab flex items-center gap-2" aria-label="Pause (P)"><Pause size={14} /> P</button>
        <button type="button" tabIndex={-1} onClick={onMute} className="tab flex items-center gap-2" aria-label={muted ? "Unmute (M)" : "Mute (M)"}>
          {muted ? <VolumeX size={14} /> : <Volume2 size={14} />} M
        </button>
      </div>
    </aside>
  );
}

/** Compact HUD for narrow windows. */
export function HudBar({ hud }: { hud: HudState }) {
  return (
    <div className="flex items-start justify-between gap-3 px-3 pb-2 pt-4 md:hidden">
      <div className="min-w-0"><div className="label leading-none">{hud.playerName}</div><div className="mt-1 font-arcade text-[13px] leading-none">{fmt(hud.score)}</div></div>
      <div className="text-center"><div className="label leading-none">LVL {hud.level}</div><div className={`mt-1 font-arcade text-[9px] leading-none ${DIFF_COLOR[hud.difficulty]}`}>{hud.difficulty}</div></div>
      <div className="pt-1"><Lives n={hud.lives} /></div>
    </div>
  );
}
