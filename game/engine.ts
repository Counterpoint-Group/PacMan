/**
 * PacmanEngine: the complete simulation + render loop. No React in here.
 * update(dt) advances the game; render() draws it. requestAnimationFrame drives both,
 * using delta-time (split into small sub-steps) so speed is identical at 60/120/144 Hz.
 */
import {
  COLS, DOOR_X, DOWN, DEATH_TOTAL_S, DifficultyKey, DifficultyLabel, FRUIT_HIT_DISTANCE, FRUIT_POS, GHOST_EAT_FREEZE_S, HOUSE_CENTER_Y,
  HOUSE_ENTRY, LEFT, LEVEL_COMPLETE_S, OUTSIDE_Y, PAC_BASE_SPEED, READY_FIRST_MS, READY_RETRY_MS, RIGHT, UP, Vec, ROWS,
} from "./constants";
import { DIFFICULTIES, RuntimeParams, resolveParams } from "./difficulty";
import { FRUITS, FruitState, FruitType } from "./fruit";
import { GHOST_ORDER, Ghost, GhostName, createGhost, resetGhost } from "./ghost";
import { Percept, chaseTarget, chooseGhostDirection } from "./ghost-ai";
import { MazeState, getMaze, walkable } from "./maze";
import { advance, canMove, moverX, moverY, reverse } from "./movement";
import { Pacman, createPacman, resetPacman } from "./pacman";
import { PELLET_SCORE, POWER_PELLET_SCORE, ghostScore } from "./scoring";
import { SoundManager, sound as sharedSound } from "./sound";
import { touching } from "./collision";
import { Layers, buildLayers, drawFrame } from "./renderer";

export type Phase = "ready" | "playing" | "dying" | "levelComplete" | "gameOver";

/** Local E2E testing switch. Set to false before using this code for a public leaderboard. */
export const GOD_MODE_ENABLED = true;

export interface HudState {
  playerName: string; score: number; highScore: number; level: number; lives: number;
  difficulty: DifficultyLabel; mazeName: string; fruit: FruitType;
}
export interface GameResult {
  score: number; levelReached: number; difficulty: DifficultyLabel; pelletsEaten: number; ghostsEaten: number;
  durationSeconds: number; clientGameId: string;
}
export interface EngineOptions {
  canvas?: HTMLCanvasElement | null;
  difficulty: DifficultyKey;
  playerName: string;
  highScore: number;
  sound?: SoundManager;
  rng?: () => number;
  onHud?: (h: HudState) => void;
  onGameOver?: (r: GameResult) => void;
  onPauseChange?: (paused: boolean) => void;
  onMuteChange?: (muted: boolean) => void;
}
export interface Popup { x: number; y: number; text: string; t: number }

const KEYS: Record<string, Vec> = {
  ArrowUp: UP, ArrowDown: DOWN, ArrowLeft: LEFT, ArrowRight: RIGHT,
  w: UP, W: UP, s: DOWN, S: DOWN, a: LEFT, A: LEFT, d: RIGHT, D: RIGHT,
};
const MODE_SEQUENCE: ("SCATTER" | "CHASE")[] = ["SCATTER", "CHASE", "SCATTER", "CHASE", "SCATTER", "CHASE", "SCATTER", "CHASE"];
const RELEASE = { pinky: { ms: 0, pellets: 0 }, inky: { ms: 5000, pellets: 30 }, clyde: { ms: 9000, pellets: 60 } } as const;
const MAX_STEP = 1 / 90;

const newId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => { const r = (Math.random() * 16) | 0; return (ch === "x" ? r : (r & 3) | 8).toString(16); });

export class PacmanEngine {
  // ---- state read by the renderer -------------------------------------------------
  phase: Phase = "ready";
  paused = false;
  time = 0;
  level = 1;
  lives = 0;
  score = 0;
  highScore = 0;
  pelletsEaten = 0;
  ghostsEaten = 0;
  playMs = 0;
  params!: RuntimeParams;
  maze!: MazeState;
  pac: Pacman = createPacman();
  ghosts: Ghost[] = GHOST_ORDER.map(createGhost);
  fruit: FruitState | null = null;
  popups: Popup[] = [];
  frightenedT = 0;
  readyT = 0;
  deathT = 0;
  lcT = 0;
  freezeT = 0;
  gameOverT = 0;
  /** Test hook: when true Pac-Man cannot be caught. */
  godMode = GOD_MODE_ENABLED;

  // ---- private simulation state ---------------------------------------------------
  private readonly diffKey: DifficultyKey;
  private readonly sfx: SoundManager;
  private readonly rng: () => number;
  private globalMode: "SCATTER" | "CHASE" = "SCATTER";
  private modeIdx = 0;
  private modeT = 0;
  private chain = 0;
  private lifeMs = 0;
  private pelletsThisLife = 0;
  private sinceLastPellet = 0;
  private fruitSpawned: boolean[] = [];
  private percept: Percept = { pacC: 14, pacR: 23, pacDx: -1, pacDy: 0, blinkyC: 14, blinkyR: 11 };
  private perceptT = 0;
  private held: Vec[] = [];
  private want: Vec | null = null;
  private wantUntil = Infinity;
  private snapshot = { score: 0, lives: 0, pelletsEaten: 0, ghostsEaten: 0, playMs: 0 };
  private clientGameId = newId();
  private lastHud = "";
  private started = false;

  // ---- rendering ------------------------------------------------------------------
  private canvas: HTMLCanvasElement | null;
  private ctx: CanvasRenderingContext2D | null = null;
  private layers: Layers | null = null;
  private k = 16;
  private raf = 0;
  private last = 0;

  constructor(private readonly opts: EngineOptions) {
    this.diffKey = opts.difficulty;
    this.sfx = opts.sound ?? sharedSound;
    this.rng = opts.rng ?? Math.random;
    this.canvas = opts.canvas ?? null;
    this.ctx = this.canvas?.getContext("2d") ?? null;
    this.highScore = opts.highScore;
    this.newGame();
  }

  // ==== lifecycle ===================================================================
  start(): void {
    if (this.started) return;
    this.started = true;
    if (typeof window === "undefined") return;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    this.started = false;
    if (typeof window === "undefined") return;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  /** Called by the UI whenever the canvas box changes. `ts` is the tile size in CSS pixels. */
  resize(ts: number, dpr: number): void {
    if (!this.canvas) return;
    const width = Math.round(COLS * ts * dpr);
    const height = Math.round(ROWS * ts * dpr);
    this.canvas.width = width;
    this.canvas.height = height;
    this.canvas.style.width = `${COLS * ts}px`;
    this.canvas.style.height = `${ROWS * ts}px`;
    this.k = width / COLS;
    this.layers = null; // rebuilt lazily
    this.ctx = this.canvas.getContext("2d");
    this.render();
  }

  pause(): void {
    if (this.paused || this.phase === "gameOver") return;
    this.paused = true;
    this.opts.onPauseChange?.(true);
  }
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.last = performance.now();
    this.opts.onPauseChange?.(false);
  }
  togglePause(): void { this.paused ? this.resume() : this.pause(); }

  toggleMute(): boolean {
    this.sfx.unlock();
    this.sfx.setMuted(!this.sfx.muted);
    this.opts.onMuteChange?.(this.sfx.muted);
    return this.sfx.muted;
  }
  get muted(): boolean { return this.sfx.muted; }

  /** Restart the current level (progress on this level and score gained on it are discarded). */
  restartLevel(): void {
    this.score = this.snapshot.score; this.lives = this.snapshot.lives;
    this.pelletsEaten = this.snapshot.pelletsEaten; this.ghostsEaten = this.snapshot.ghostsEaten; this.playMs = this.snapshot.playMs;
    this.loadLevel(this.level);
    this.paused = false; this.last = performance.now();
    this.opts.onPauseChange?.(false);
  }

  restartGame(): void {
    this.newGame();
    this.paused = false; this.last = performance.now();
    this.opts.onPauseChange?.(false);
  }

  // ==== game flow ===================================================================
  private newGame(): void {
    this.level = 1; this.score = 0; this.pelletsEaten = 0; this.ghostsEaten = 0; this.playMs = 0;
    this.lives = DIFFICULTIES[this.diffKey].lives;
    this.clientGameId = newId();
    this.popups = [];
    this.loadLevel(1, true);
  }

  private loadLevel(level: number, firstStart = false): void {
    this.level = level;
    this.params = resolveParams(level, this.diffKey);
    this.maze = new MazeState(getMaze(this.params.mazeId));
    this.fruit = null;
    this.fruitSpawned = this.params.fruitSpawn.map(() => false);
    this.snapshot = { score: this.score, lives: this.lives, pelletsEaten: this.pelletsEaten, ghostsEaten: this.ghostsEaten, playMs: this.playMs };
    this.resetPositions(firstStart ? READY_FIRST_MS : READY_RETRY_MS + 500);
    if (firstStart) this.sfx.play("start");
    this.layers = null;
    this.syncHud(true);
  }

  /** Reset characters + timers, but NOT score, pellets, level. */
  private resetPositions(readyMs: number): void {
    resetPacman(this.pac);
    this.globalMode = "SCATTER"; this.modeIdx = 0; this.modeT = 0;
    this.frightenedT = 0; this.chain = 0;
    this.lifeMs = 0; this.pelletsThisLife = 0; this.sinceLastPellet = 0;
    this.ghosts.forEach((g) => resetGhost(g, "SCATTER"));
    this.held = []; this.want = null;
    this.snapshotPercept();
    this.perceptT = 0;
    this.phase = "ready"; this.readyT = readyMs / 1000;
    this.deathT = 0; this.lcT = 0; this.freezeT = 0;
    this.fruit = null;
  }

  private killPac(): void {
    this.phase = "dying"; this.deathT = 0; this.deathSoundDone = false;
    this.lives = Math.max(0, this.lives - 1);
    this.fruit = null;
    this.syncHud();
  }

  private finishDeath(): void {
    if (this.lives > 0) { this.resetPositions(READY_RETRY_MS); return; }
    this.phase = "gameOver"; this.gameOverT = 0;
    this.syncHud(true);
    this.opts.onGameOver?.(this.result());
  }

  result(): GameResult {
    return {
      score: this.score, levelReached: this.level, difficulty: DIFFICULTIES[this.diffKey].label,
      pelletsEaten: this.pelletsEaten, ghostsEaten: this.ghostsEaten, durationSeconds: Math.round(this.playMs / 1000),
      clientGameId: this.clientGameId,
    };
  }

  private syncHud(force = false): void {
    if (!this.opts.onHud) return;
    const hud: HudState = {
      playerName: this.opts.playerName, score: this.score, highScore: Math.max(this.highScore, this.score), level: this.level,
      lives: this.lives, difficulty: DIFFICULTIES[this.diffKey].label, mazeName: this.params.mazeName, fruit: this.params.fruit,
    };
    const key = JSON.stringify(hud);
    if (force || key !== this.lastHud) { this.lastHud = key; this.opts.onHud(hud); }
  }

  // ==== main loop ===================================================================
  private frame = (now: number): void => {
    if (!this.started) return;
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (!this.paused) {
      const steps = Math.max(1, Math.ceil(dt / MAX_STEP));
      for (let i = 0; i < steps; i++) this.update(dt / steps);
    }
    this.render();
    this.raf = requestAnimationFrame(this.frame);
  };

  update(dt: number): void {
    this.time += dt;
    for (const p of this.popups) p.t -= dt;
    this.popups = this.popups.filter((p) => p.t > 0);

    switch (this.phase) {
      case "ready":
        this.readyT -= dt;
        if (this.readyT <= 0) this.phase = "playing";
        return;
      case "dying":
        this.deathT += dt;
        if (!this.deathSoundDone && this.deathT >= 0.75) { this.deathSoundDone = true; this.sfx.play("death"); }
        if (this.deathT >= DEATH_TOTAL_S) this.finishDeath();
        return;
      case "levelComplete":
        this.lcT += dt;
        if (this.lcT >= LEVEL_COMPLETE_S) { this.loadLevel(this.level + 1); }
        return;
      case "gameOver":
        this.gameOverT += dt;
        return;
    }

    if (this.freezeT > 0) { this.freezeT -= dt; return; }

    const ms = dt * 1000;
    this.playMs += ms;
    this.tickModeTimers(ms);
    this.updatePacman(dt);
    this.updateGhosts(dt);
    this.checkCollisions();
    this.updateFruit(ms);
    if (this.phase === "playing" && this.maze.remaining === 0) {
      this.phase = "levelComplete"; this.lcT = 0; this.fruit = null; this.sfx.play("level");
    }
  }
  private deathSoundDone = false;

  // ==== timers / modes ==============================================================
  private modeDuration(idx: number): number {
    const s = this.params.scatterMs, c = this.params.chaseMs;
    return [s, c, s, c, s * 0.7, c, s * 0.7, Infinity][idx];
  }

  private tickModeTimers(ms: number): void {
    if (this.frightenedT > 0) {
      this.frightenedT -= ms;
      if (this.frightenedT <= 0) {
        this.frightenedT = 0; this.chain = 0;
        for (const g of this.ghosts) if (g.state === "FRIGHTENED") g.state = this.globalMode;
      }
      return; // scatter/chase clock is paused while ghosts are frightened
    }
    this.modeT += ms;
    while (this.modeT >= this.modeDuration(this.modeIdx)) {
      this.modeT -= this.modeDuration(this.modeIdx);
      this.modeIdx = Math.min(this.modeIdx + 1, MODE_SEQUENCE.length - 1);
      this.globalMode = MODE_SEQUENCE[this.modeIdx];
      for (const g of this.ghosts) {
        if (g.state === "SCATTER" || g.state === "CHASE") { g.state = this.globalMode; reverse(this.maze.geo, g); }
      }
    }
  }

  private startFrightened(): void {
    this.frightenedT = this.params.frightenedMs;
    this.chain = 0;
    for (const g of this.ghosts) {
      if (g.state === "SCATTER" || g.state === "CHASE" || g.state === "FRIGHTENED") { g.state = "FRIGHTENED"; reverse(this.maze.geo, g); }
    }
  }

  get flashing(): boolean { return this.frightenedT > 0 && this.frightenedT < this.params.flashMs && Math.floor(this.frightenedT / 200) % 2 === 0; }

  private elroy(): number {
    const ratio = this.maze.remaining / this.maze.geo.totalPellets;
    return ratio <= 0.06 ? 2 : ratio <= 0.12 ? 1 : 0;
  }

  // ==== input =======================================================================
  pressDir(d: Vec): void {
    this.held = this.held.filter((h) => h !== d);
    this.held.push(d);
    this.want = d; this.wantUntil = Infinity;
  }
  releaseDir(d: Vec): void {
    this.held = this.held.filter((h) => h !== d);
    if (this.want === d) {
      if (this.held.length) this.want = this.held[this.held.length - 1];
      else this.wantUntil = this.time + 0.45; // a quick tap stays buffered briefly
    }
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const dir = KEYS[e.key];
    if (dir) {
      if (this.paused || this.phase === "gameOver") return;
      e.preventDefault();
      if (!e.repeat) this.pressDir(dir);
      return;
    }
    if (e.key === "p" || e.key === "P" || e.key === "Escape") { e.preventDefault(); if (!e.repeat) this.togglePause(); return; }
    if (e.key === "m" || e.key === "M") { if (!e.repeat) this.toggleMute(); }
  };
  private onKeyUp = (e: KeyboardEvent): void => { const dir = KEYS[e.key]; if (dir) this.releaseDir(dir); };
  private onVisibility = (): void => { if (document.hidden) this.pause(); };

  // ==== Pac-Man =====================================================================
  private updatePacman(dt: number): void {
    const p = this.pac, geo = this.maze.geo;
    if (this.want && this.time > this.wantUntil) this.want = null;
    const want = this.want;
    // Instant U-turns anywhere in a corridor.
    if (want && (p.dx !== 0 || p.dy !== 0) && want.x === -p.dx && want.y === -p.dy) reverse(geo, p);
    // Start moving again from a standstill.
    if (p.dx === 0 && p.dy === 0 && want && canMove(geo, p, want.x, want.y)) { p.dx = want.x; p.dy = want.y; }
    if (p.dx !== 0 || p.dy !== 0) { p.facing = { x: p.dx, y: p.dy }; p.mouth += dt * 9; }
    const speed = this.params.pacSpeed * (this.frightenedT > 0 ? 1.1 : 1);
    advance(p, speed * dt, () => this.onPacArrive());
  }

  private onPacArrive(): void {
    const p = this.pac, geo = this.maze.geo;
    this.eatAt(p.c, p.r);
    const want = this.want; // buffered turn: takes effect at the first tile centre where it is legal
    if (want && canMove(geo, p, want.x, want.y)) { p.dx = want.x; p.dy = want.y; }
    if (!canMove(geo, p, p.dx, p.dy)) { p.dx = 0; p.dy = 0; }
  }

  private eatAt(c: number, r: number): void {
    const kind = this.maze.eat(c, r);
    if (!kind) return;
    this.pelletsEaten++; this.pelletsThisLife++; this.sinceLastPellet = 0;
    if (kind === 1) { this.addScore(PELLET_SCORE); this.sfx.play("pellet"); }
    else { this.addScore(POWER_PELLET_SCORE); this.startFrightened(); this.sfx.play("power"); }
    this.maybeSpawnFruit();
  }

  /** Adds a base award times the difficulty's score multiplier. Returns the points actually awarded. */
  private addScore(base: number): number {
    const pts = Math.round(base * DIFFICULTIES[this.diffKey].scoreMultiplier);
    this.score += pts;
    this.syncHud();
    return pts;
  }

  // ==== fruit =======================================================================
  private maybeSpawnFruit(): void {
    const frac = this.maze.eaten / this.maze.geo.totalPellets;
    this.params.fruitSpawn.forEach((threshold, i) => {
      if (!this.fruitSpawned[i] && frac >= threshold) {
        this.fruitSpawned[i] = true;
        this.fruit = { type: this.params.fruit, x: FRUIT_POS.x, y: FRUIT_POS.y, msLeft: this.params.fruitLifetimeMs, points: FRUITS[this.params.fruit].points };
      }
    });
  }

  private updateFruit(ms: number): void {
    const f = this.fruit;
    if (!f) return;
    f.msLeft -= ms;
    if (f.msLeft <= 0) { this.fruit = null; return; }
    if (touching(moverX(this.pac), moverY(this.pac), f.x, f.y, FRUIT_HIT_DISTANCE)) {
      const pts = this.addScore(f.points);
      this.popups.push({ x: f.x, y: f.y, text: String(pts), t: 1.2 });
      this.sfx.play("fruit");
      this.fruit = null;
    }
  }

  // ==== ghosts ======================================================================
  private snapshotPercept(): void {
    const p = this.pac, b = this.ghosts[0];
    this.percept = {
      pacC: Math.floor(moverX(p)), pacR: Math.floor(moverY(p)), pacDx: p.facing.x, pacDy: p.facing.y,
      blinkyC: Math.floor(b.x), blinkyR: Math.floor(b.y),
    };
  }

  private updateGhosts(dt: number): void {
    const ms = dt * 1000;
    this.lifeMs += ms; this.sinceLastPellet += ms;
    this.perceptT -= ms;
    if (this.perceptT <= 0) { this.snapshotPercept(); this.perceptT = this.params.reactionMs; }
    this.releaseGhosts();
    for (const g of this.ghosts) this.updateGhost(g, dt);
  }

  private releaseGhosts(): void {
    const scale = this.params.releaseScale;
    for (const g of this.ghosts) {
      if (g.state === "IN_GHOST_HOUSE" && g.regen && g.houseTimer <= 0) g.state = "LEAVING_GHOST_HOUSE";
    }
    for (const name of ["pinky", "inky", "clyde"] as const) {
      const g = this.ghosts.find((x) => x.name === name)!;
      if (g.state !== "IN_GHOST_HOUSE" || g.regen) continue;
      const rule = RELEASE[name];
      if (this.lifeMs >= rule.ms * scale || this.pelletsThisLife >= rule.pellets * scale || this.sinceLastPellet >= 4000 * scale) {
        g.state = "LEAVING_GHOST_HOUSE"; this.sinceLastPellet = 0;
      }
      break; // strictly one at a time, in order
    }
  }

  private ghostSpeed(g: Ghost): number {
    const base = this.params.ghostSpeed;
    if (g.state === "EATEN") return PAC_BASE_SPEED * 2;
    let s = base;
    if (g.state === "FRIGHTENED") s = base * 0.55;
    else if (g.name === "blinky") s = base * (1 + 0.04 * this.elroy());
    if (this.maze.geo.tunnelRows[g.r] && (g.c <= 5 || g.c >= COLS - 6)) s = Math.min(s, base * 0.5);
    return Math.min(s, PAC_BASE_SPEED * 1.25);
  }

  private updateGhost(g: Ghost, dt: number): void {
    g.anim += dt;
    switch (g.state) {
      case "IN_GHOST_HOUSE":
        g.houseTimer = Math.max(0, g.houseTimer - dt * 1000);
        g.x += (g.homeX - g.x) * Math.min(1, dt * 8);
        g.y = g.homeY + Math.sin(g.anim * 7) * 0.22;
        return;
      case "LEAVING_GHOST_HOUSE": this.moveLeaving(g, dt); return;
      case "EATEN":
        if (g.eatenPhase === "enter") { this.moveEntering(g, dt); return; }
      // fallthrough: 'return' phase uses normal grid movement
      default:
        advance(g, this.ghostSpeed(g) * dt, () => this.onGhostArrive(g));
        g.x = moverX(g); g.y = moverY(g);
        if (g.dx !== 0 || g.dy !== 0) g.face = { x: g.dx, y: g.dy };
    }
  }

  private moveLeaving(g: Ghost, dt: number): void {
    const step = 3.4 * dt;
    g.face = UP;
    if (Math.abs(g.x - DOOR_X) > 0.02) {
      g.x += Math.max(-step, Math.min(step, DOOR_X - g.x));
      g.y += (HOUSE_CENTER_Y - g.y) * Math.min(1, dt * 10);
      return;
    }
    g.x = DOOR_X;
    g.y -= step;
    if (g.y <= OUTSIDE_Y) {
      g.y = OUTSIDE_Y; g.c = 14; g.r = 11; g.off = 0.5; g.dx = -1; g.dy = 0; g.face = LEFT;
      g.regen = false;
      g.state = this.frightenedT > 0 ? "FRIGHTENED" : this.globalMode;
    }
  }

  private moveEntering(g: Ghost, dt: number): void {
    const step = 5 * dt;
    if (Math.abs(g.x - DOOR_X) > 0.02) { g.x += Math.max(-step, Math.min(step, DOOR_X - g.x)); return; }
    g.x = DOOR_X; g.y += step; g.face = DOWN;
    if (g.y >= HOUSE_CENTER_Y) { g.y = HOUSE_CENTER_Y; g.state = "IN_GHOST_HOUSE"; g.regen = true; g.houseTimer = 800; g.eatenPhase = "return"; }
  }

  private onGhostArrive(g: Ghost): void {
    const geo = this.maze.geo;
    let dir: Vec;
    if (g.state === "EATEN") {
      if (g.c === HOUSE_ENTRY.c && g.r === HOUSE_ENTRY.r) { g.eatenPhase = "enter"; g.dx = 0; g.dy = 0; return; }
      dir = chooseGhostDirection(g, geo, "home", null, this.rng);
    } else if (g.state === "FRIGHTENED") {
      dir = chooseGhostDirection(g, geo, "random", null, this.rng);
    } else {
      // Blinky in "Cruise Elroy 2" ignores scatter and keeps hunting.
      const useCorner = g.state === "SCATTER" && !(g.name === "blinky" && this.elroy() >= 2);
      const target: Vec = useCorner ? g.scatterTarget : chaseTarget(g, this.percept, this.params.aggression);
      dir = chooseGhostDirection(g, geo, "target", target, this.rng);
    }
    g.dx = dir.x; g.dy = dir.y;
  }

  // ==== collisions ==================================================================
  private checkCollisions(): void {
    const px = moverX(this.pac), py = moverY(this.pac);
    if (!this.godMode) {
      for (const g of this.ghosts) {
        if ((g.state === "SCATTER" || g.state === "CHASE") && touching(px, py, g.x, g.y)) { this.killPac(); return; }
      }
    }
    for (const g of this.ghosts) {
      const activeGhost = g.state === "SCATTER" || g.state === "CHASE" || g.state === "FRIGHTENED";
      if (activeGhost && (g.state === "FRIGHTENED" || this.godMode) && touching(px, py, g.x, g.y)) {
        // In God Mode the normal 200/400/800/1600 sequence repeats for each group of four ghosts.
        const chainIndex = this.godMode ? this.chain++ % 4 : this.chain++;
        const pts = this.addScore(ghostScore(chainIndex));
        this.ghostsEaten++;
        g.state = "EATEN"; g.eatenPhase = "return";
        this.popups.push({ x: g.x, y: g.y, text: String(pts), t: 1.1 });
        this.freezeT = GHOST_EAT_FREEZE_S;
        this.sfx.play("ghost");
        return;
      }
    }
  }

  // ==== rendering ===================================================================
  render(): void {
    if (!this.ctx || !this.canvas) return;
    if (!this.layers || this.layers.mazeId !== this.maze.geo.id || this.layers.k !== this.k) this.layers = buildLayers(this.maze.geo, this.k);
    drawFrame(this.ctx, this, this.k, this.layers);
  }

  /** Test helper: is Pac-Man currently on a legal tile? */
  walkableUnderPac(): boolean {
    return walkable(this.maze.geo, this.pac.c, this.pac.r) && walkable(this.maze.geo, this.pac.c + this.pac.dx, this.pac.r + this.pac.dy) || (this.pac.dx === 0 && this.pac.dy === 0);
  }

  get ghostByName(): Record<GhostName, Ghost> {
    return Object.fromEntries(this.ghosts.map((g) => [g.name, g])) as Record<GhostName, Ghost>;
  }
}

