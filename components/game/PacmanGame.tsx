"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { DOWN, LEFT, RIGHT, UP, type DifficultyKey, type Vec } from "@/game/constants";
import { GOD_MODE_ENABLED, type GameResult, type HudState, type PacmanEngine } from "@/game/engine";
import { sound } from "@/game/sound";
import { ApiError, apiPost } from "@/lib/api";
import type { CompleteGameResponse, PlayerProfile } from "@/lib/types";
import GameCanvas from "./GameCanvas";
import { HudBar, HudLeft, HudRight } from "./GameHUD";
import GameOver, { SaveState } from "./GameOver";
import PauseMenu, { Confirm, PauseSaveState } from "./PauseMenu";

interface Props {
  player: PlayerProfile;
  difficulty: DifficultyKey;
  onExit: () => void;
  onLeaderboard: () => void;
  onPlayAgain: () => void;
  onProfile: (p: PlayerProfile) => void;
}

/** React owns menus, HUD, save flow. The engine owns everything that changes 60 times per second. */
export default function PacmanGame({ player, difficulty, onExit, onLeaderboard, onPlayAgain, onProfile }: Props) {
  const engineRef = useRef<PacmanEngine | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(sound.muted);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [result, setResult] = useState<GameResult | null>(null);
  const [showOver, setShowOver] = useState(false);
  const [save, setSave] = useState<SaveState>({ status: "saving" });
  const [pauseSave, setPauseSave] = useState<PauseSaveState>({ status: "idle" });
  const pauseSaveLockRef = useRef(false);
  const [showTouchControls, setShowTouchControls] = useState(false);

  const options = useMemo(() => ({
    difficulty, playerName: player.name.split(" ")[0].toUpperCase(), highScore: player.highScore,
    onHud: setHud,
    onGameOver: setResult,
    onPauseChange: (p: boolean) => { setPaused(p); if (!p) setConfirm(null); },
    onMuteChange: setMuted,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [difficulty]);

  const saveResult = useCallback(async (r: GameResult) => {
    const res = await apiPost<CompleteGameResponse>("/api/game/complete", r);
    onProfile(res.profile);
    return res;
  }, [onProfile]);

  const submit = useCallback(async (r: GameResult) => {
    setSave({ status: "saving" });
    try {
      const res = await saveResult(r);
      setSave({ status: "saved", newHighScore: res.isNewHighScore });
    } catch (err) {
      setSave({ status: "error", message: err instanceof ApiError ? err.message : "Something went wrong." });
    }
  }, [saveResult]);

  useEffect(() => {
    const coarse = window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 900;
    setShowTouchControls(coarse);
    const onResize = () => setShowTouchControls(window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 900);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!result) return;
    void submit(result);
    const t = setTimeout(() => setShowOver(true), 1600); // let "GAME OVER" sit on the board first
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const pressDir = useCallback((dir: Vec) => engineRef.current?.pressDir(dir), []);
  const releaseDir = useCallback((dir: Vec) => engineRef.current?.releaseDir(dir), []);
  const releaseAllDirs = useCallback(() => {
    [UP, LEFT, DOWN, RIGHT].forEach(releaseDir);
  }, [releaseDir]);
  const [stick, setStick] = useState({ x: 0, y: 0 });
  const joystickRef = useRef<HTMLDivElement | null>(null);
  const gamepadDirRef = useRef<Vec | null>(null);
  const updateJoystick = useCallback((clientX: number, clientY: number) => {
    const node = joystickRef.current;
    if (!node) return;

    const rect = node.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    const radius = rect.width / 2 - 18;
    const mag = Math.min(Math.hypot(dx, dy), radius);
    const angle = Math.atan2(dy, dx);
    const clampedX = Math.cos(angle) * mag;
    const clampedY = Math.sin(angle) * mag;
    const absX = Math.abs(clampedX);
    const absY = Math.abs(clampedY);

    const nextDir: Vec | null = absX > absY
      ? (clampedX >= 0 ? RIGHT : LEFT)
      : (clampedY >= 0 ? DOWN : UP);

    releaseAllDirs();
    if (nextDir) pressDir(nextDir);
    setStick({ x: clampedX / radius, y: clampedY / radius });
  }, [pressDir, releaseAllDirs]);
  const resetJoystick = useCallback(() => {
    releaseAllDirs();
    setStick({ x: 0, y: 0 });
  }, [releaseAllDirs]);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      if (!engineRef.current) {
        frame = window.requestAnimationFrame(tick);
        return;
      }

      const pad = typeof navigator !== "undefined" ? navigator.getGamepads?.()[0] : null;
      if (!pad) {
        if (gamepadDirRef.current) {
          releaseDir(gamepadDirRef.current);
          gamepadDirRef.current = null;
        }
        frame = window.requestAnimationFrame(tick);
        return;
      }

      const dpadMap = [
        { button: 12, dir: UP },
        { button: 13, dir: DOWN },
        { button: 14, dir: LEFT },
        { button: 15, dir: RIGHT },
      ] as const;
      const dpadActive = dpadMap.find(({ button }) => pad.buttons[button]?.pressed)?.dir ?? null;
      const x = pad.axes[0] ?? 0;
      const y = pad.axes[1] ?? 0;
      const stickActive = Math.abs(x) > 0.45 || Math.abs(y) > 0.45
        ? (Math.abs(x) > Math.abs(y) ? (x >= 0 ? RIGHT : LEFT) : (y >= 0 ? DOWN : UP))
        : null;

      const nextDir = dpadActive ?? stickActive;
      if (gamepadDirRef.current && gamepadDirRef.current !== nextDir) {
        releaseDir(gamepadDirRef.current);
      }
      if (nextDir) {
        if (!gamepadDirRef.current || gamepadDirRef.current !== nextDir) {
          pressDir(nextDir);
        }
        gamepadDirRef.current = nextDir;
      } else if (gamepadDirRef.current) {
        releaseDir(gamepadDirRef.current);
        gamepadDirRef.current = null;
      }

      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [pressDir, releaseDir]);

  const resume = () => engineRef.current?.resume();
  const doRestartLevel = () => { setConfirm(null); engineRef.current?.restartLevel(); };
  const saveThen = useCallback(async (action: "restart" | "quit") => {
    const engine = engineRef.current;
    if (!engine || pauseSaveLockRef.current) return;
    pauseSaveLockRef.current = true;
    setPauseSave({ status: "saving" });
    try {
      const saved = await saveResult(engine.result());
      pauseSaveLockRef.current = false;
      setPauseSave({ status: "idle" });
      setConfirm(null);
      if (action === "restart") {
        engine.highScore = saved.profile.highScore;
        setHud(null);
        engine.restartGame();
      } else {
        onExit();
      }
    } catch (err) {
      pauseSaveLockRef.current = false;
      setPauseSave({ status: "error", message: err instanceof ApiError ? err.message : "Couldn't save your score. Please try again." });
    }
  }, [onExit, saveResult]);
  const doRestartGame = () => { void saveThen("restart"); };
  const doQuit = () => { void saveThen("quit"); };

  return (
    <div className="crt fixed inset-0 flex h-[100dvh] flex-col overflow-hidden bg-[#02030a]">
      {hud && <HudBar hud={hud} />}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {hud && <HudLeft hud={hud} />}
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          <GameCanvas options={options} onEngine={(e) => { engineRef.current = e; }} />
          {GOD_MODE_ENABLED && (
            <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 border-2 border-[var(--pac)] bg-[#02030a]/90 px-3 py-2 font-arcade text-[9px] neon-yellow">
              GOD MODE · E2E TEST
            </div>
          )}
          {paused && !result && (
            <PauseMenu
              confirm={confirm}
              saveState={pauseSave}
              onConfirm={(next) => { setConfirm(next); setPauseSave({ status: "idle" }); }}
              onResume={resume}
              onRestartLevel={doRestartLevel}
              onRestartGame={doRestartGame}
              onQuit={doQuit}
            />
          )}
          {result && showOver && (
            <GameOver
              playerName={player.name} result={result} save={save}
              onRetry={() => void submit(result)}
              onPlayAgain={onPlayAgain} onLeaderboard={onLeaderboard} onMenu={onExit}
            />
          )}
        </div>
        {hud && <HudRight hud={hud} muted={muted} onMute={() => engineRef.current?.toggleMute()} onPause={() => engineRef.current?.pause()} />}
      </div>
      {showTouchControls && !result && !paused && (
        <>
          <div className="mobile-top-actions pointer-events-none absolute left-3 top-16 z-20 md:hidden">
            <button type="button" className="mobile-action pointer-events-auto" aria-label={paused ? "Resume" : "Pause"} onClick={() => { if (paused) engineRef.current?.resume(); else engineRef.current?.pause(); }}>
              {paused ? <Play size={18} strokeWidth={2.8} fill="currentColor" /> : <Pause size={18} strokeWidth={2.8} />}
            </button>
            <button type="button" className="mobile-action pointer-events-auto" aria-label={muted ? "Unmute" : "Mute"} onClick={() => engineRef.current?.toggleMute()}>
              {muted ? <VolumeX size={18} strokeWidth={2.8} /> : <Volume2 size={18} strokeWidth={2.8} />}
            </button>
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-[calc(12px+env(safe-area-inset-bottom,0px))] z-20 flex justify-center px-4 md:hidden">
            <div
              ref={joystickRef}
              className="mobile-joystick pointer-events-auto"
              aria-label="Move controls"
              onPointerDown={(event) => { event.preventDefault(); updateJoystick(event.clientX, event.clientY); }}
              onPointerMove={(event) => {
                if (event.buttons !== 1) return;
                updateJoystick(event.clientX, event.clientY);
              }}
              onPointerUp={resetJoystick}
              onPointerLeave={resetJoystick}
              onPointerCancel={resetJoystick}
            >
              <div className="mobile-joystick-ring" aria-hidden="true" />
              <div className="mobile-joystick-stick" style={{ transform: `translate(${stick.x * 28}px, ${stick.y * 28}px)` }} aria-hidden="true" />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
