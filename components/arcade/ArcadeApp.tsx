"use client";
import { useCallback, useEffect, useState } from "react";
import type { DifficultyKey } from "@/game/constants";
import { sound } from "@/game/sound";
import { apiGet, apiPost } from "@/lib/api";
import type { PlayerProfile } from "@/lib/types";
import PacmanGame from "../game/PacmanGame";
import DifficultySelector from "./DifficultySelector";
import HowToPlay from "./HowToPlay";
import Intro from "./Intro";
import Leaderboard from "./Leaderboard";
import MainMenu from "./MainMenu";
import PlayerSelector from "./PlayerSelector";
import { Brand, PacLoader } from "./ui";

type Screen = "boot" | "intro" | "select" | "menu" | "difficulty" | "game" | "leaderboard" | "howto";

/** Top-level flow: INTRO -> WHO'S PLAYING? -> MENU -> DIFFICULTY -> GAME -> GAME OVER -> LEADERBOARD */
export default function ArcadeApp() {
  const [screen, setScreen] = useState<Screen>("boot");
  const [player, setPlayer] = useState<PlayerProfile | null>(null);
  const [difficulty, setDifficulty] = useState<DifficultyKey>("OK_OK");
  const [gameId, setGameId] = useState(0);
  const [tooSmall, setTooSmall] = useState(false);
  const [portraitOnly, setPortraitOnly] = useState(false);

  // Restore the verified player (signed cookie) after a refresh; show the loader for a beat.
  useEffect(() => {
    let live = true;
    const minDelay = new Promise((r) => setTimeout(r, 900));
    const session = apiGet<{ player: PlayerProfile | null }>("/api/session").then((r) => r.player).catch(() => null);
    Promise.all([session, minDelay]).then(([p]) => { if (!live) return; setPlayer(p); setScreen("intro"); });
    return () => { live = false; };
  }, []);

  // Browsers only allow audio after a gesture.
  useEffect(() => {
    const unlock = () => sound.unlock();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => { window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); };
  }, []);

  useEffect(() => {
    const check = () => {
      const isPortrait = window.innerHeight >= window.innerWidth;
      const coarse = window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 900;
      const isTiny = Math.min(window.innerWidth, window.innerHeight) < 360;
      setTooSmall(isTiny);
      setPortraitOnly(coarse && !isPortrait);
    };
    check();
    window.addEventListener("resize", check);
    window.addEventListener("orientationchange", check);
    return () => {
      window.removeEventListener("resize", check);
      window.removeEventListener("orientationchange", check);
    };
  }, []);

  // Any screen that needs a verified player falls back to "WHO'S PLAYING?" if the session is gone.
  useEffect(() => {
    if (!player && ["menu", "difficulty", "leaderboard", "game"].includes(screen)) setScreen("select");
  }, [player, screen]);

  const goMenu = useCallback(() => setScreen("menu"), []);
  const changePlayer = useCallback(async () => {
    try { await apiPost("/api/player/logout"); } catch { /* cookie expires on its own */ }
    setPlayer(null); setScreen("select");
  }, []);
  const startGame = useCallback((d: DifficultyKey) => { sound.unlock(); setDifficulty(d); setGameId((g) => g + 1); setScreen("game"); }, []);

  if (tooSmall) {
    return (
      <main className="crt flex min-h-screen items-center justify-center p-8 text-center">
        <div className="panel max-w-sm p-8">
          <p className="font-arcade text-[13px] leading-[1.9] neon-yellow">For the best arcade experience, use a desktop or laptop.</p>
        </div>
      </main>
    );
  }

  if (portraitOnly) {
    return (
      <main className="crt flex min-h-screen items-center justify-center p-8 text-center">
        <div className="panel max-w-sm p-8">
          <p className="font-arcade text-[13px] leading-[1.9] neon-yellow">PORTRAIT MODE ONLY</p>
          <p className="mt-4 font-arcade text-[9px] text-[#b8c4ff]">ROTATE YOUR DEVICE TO CONTINUE</p>
        </div>
      </main>
    );
  }

  if (screen === "game" && player) {
    return (
      <PacmanGame
        key={gameId} player={player} difficulty={difficulty}
        onExit={goMenu} onPlayAgain={() => setScreen("difficulty")} onLeaderboard={() => setScreen("leaderboard")}
        onProfile={setPlayer}
      />
    );
  }

  return (
    <main className={`crt relative w-full ${screen === "game" ? "h-[100dvh] overflow-hidden" : "min-h-[100dvh] overflow-y-auto overflow-x-hidden"}`}>
      {screen !== "intro" && <Brand className="absolute left-5 top-5 z-20" />}
      <div className={`mx-auto flex w-full flex-col items-center justify-center ${screen === "game" ? "h-full overflow-hidden" : "min-h-[100dvh] overflow-visible"} ${screen === "intro" ? "" : "px-4 pb-6 pt-12 sm:px-6 sm:py-20"}`}>
        {screen === "boot" && <PacLoader />}
        {screen === "intro" && <Intro onStart={() => setScreen(player ? "menu" : "select")} />}
        {screen === "select" && <PlayerSelector onVerified={(p) => { setPlayer(p); setScreen("menu"); }} onBack={() => setScreen("intro")} />}
        {screen === "menu" && player && (
          <MainMenu player={player} onPlay={() => setScreen("difficulty")} onLeaderboard={() => setScreen("leaderboard")} onHowTo={() => setScreen("howto")} onChangePlayer={changePlayer} />
        )}
        {screen === "difficulty" && <DifficultySelector onSelect={startGame} onBack={goMenu} />}
        {screen === "leaderboard" && player && <Leaderboard playerId={player.id} onBack={goMenu} />}
        {screen === "howto" && <HowToPlay onBack={goMenu} />}
      </div>
    </main>
  );
}
