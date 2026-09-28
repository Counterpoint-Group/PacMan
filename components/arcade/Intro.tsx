"use client";
import { useCallback, useEffect, useState } from "react";
import { sound } from "@/game/sound";
import { GhostIcon, PacChomp } from "./ui";

const GHOSTS = ["#ff2b2b", "#ff8fd8", "#19e6ff", "#ffa733"];

export default function Intro({ onStart }: { onStart: () => void }) {
  /** Bumping this remounts the animated content so the intro (and its jingle) can replay in sync. */
  const [run, setRun] = useState(0);
  /** True when the browser blocked audio; the first click / key press then enables sound instead of skipping. */
  const [needsGesture, setNeedsGesture] = useState(false);

  // Try to play the intro jingle straight away. Browsers only allow this if the visitor has already
  // interacted with the site (or has a high "media engagement" score); otherwise we ask for a click.
  useEffect(() => {
    let live = true;
    sound.unlock();
    sound.whenRunning(400).then((ok) => {
      if (!live) return;
      if (ok) sound.play("intro");
      else if (!sound.muted) setNeedsGesture(true);
    });
    return () => { live = false; };
  }, []);

  const go = useCallback(() => {
    if (needsGesture) {
      sound.unlock();
      setNeedsGesture(false);
      setRun((r) => r + 1); // restart the reveal so the jingle lines up with the text
      sound.whenRunning(400).then((ok) => { if (ok) sound.play("intro"); });
      return;
    }
    onStart();
  }, [needsGesture, onStart]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  return (
    <button type="button" onClick={go} aria-label="Press start" className="relative flex min-h-screen w-full cursor-pointer flex-col items-center justify-center overflow-hidden px-6 text-center focus:outline-none">
      <div key={run} className="contents">
        <p className="font-arcade text-[14px] neon-blue appear" style={{ animationDelay: ".3s" }}>COUNTERPOINT</p>
        <p className="font-arcade mt-3 text-[11px] text-[#8ea6ff] appear" style={{ animationDelay: ".9s" }}>PRESENTS</p>

        <h1 className="pixel-title mt-14 text-[clamp(38px,9vw,92px)] leading-none appear" style={{ animationDelay: "1.6s" }}>PAC-MAN</h1>
        <p className="font-arcade mt-6 text-[clamp(11px,1.6vw,18px)] tracking-[.2em] text-white appear" style={{ animationDelay: "2.2s" }}>ARCADE CHALLENGE</p>

        <div className="relative mt-16 h-10 w-full appear" style={{ animationDelay: "2.7s" }} aria-hidden="true">
          <div className="parade absolute left-0 top-0 flex items-center gap-3">
            {GHOSTS.map((c, i) => <div key={c} className="bob" style={{ animationDelay: `${i * 0.12}s` }}><GhostIcon color={c} size={34} /></div>)}
            <PacChomp size={36} />
          </div>
        </div>

        <p className="font-arcade blink mt-14 text-[15px] neon-yellow appear" style={{ animationDelay: "3.2s" }}>PRESS START</p>
        <p className="font-arcade mt-4 text-[8px] text-[#4a5aa8] appear" style={{ animationDelay: "3.2s" }}>CLICK OR PRESS ENTER</p>
      </div>

      {needsGesture && (
        <p className="font-arcade blink absolute bottom-8 left-0 right-0 text-[9px] text-[#8ea6ff]">CLICK OR PRESS A KEY FOR SOUND</p>
      )}
    </button>
  );
}
