// Headless engine smoke test:  npm run test:engine
import { PacmanEngine } from "../game/engine";
import { DIFFICULTIES, resolveParams } from "../game/difficulty";
import { getLevelConfig, LEVELS } from "../game/levels";
import { DIR_PRIORITY, COLS, DifficultyKey } from "../game/constants";
import { getMaze, walkable } from "../game/maze";
import { moverX, moverY } from "../game/movement";

let failures = 0;
const check = (cond: boolean, msg: string) => { if (!cond) { failures++; console.error("  FAIL:", msg); } };
const seeded = (s: number) => () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

function sanity(e: PacmanEngine, label: string) {
  const x = moverX(e.pac), y = moverY(e.pac);
  check(Number.isFinite(x) && Number.isFinite(y), `${label}: pac position NaN`);
  check(x > -1.6 && x < COLS + 1.6 && y > 0 && y < 31, `${label}: pac out of bounds (${x},${y})`);
  check(e.walkableUnderPac(), `${label}: pac inside a wall`);
  for (const g of e.ghosts) {
    check(Number.isFinite(g.x) && Number.isFinite(g.y), `${label}: ${g.name} NaN`);
    if (g.state !== "IN_GHOST_HOUSE" && g.state !== "LEAVING_GHOST_HOUSE" && !(g.state === "EATEN" && g.eatenPhase === "enter"))
      check(walkable(e.maze.geo, g.c, g.r), `${label}: ${g.name} on non-walkable tile ${g.c},${g.r} (${g.state})`);
  }
}

// 1. Random-input fuzz on every difficulty (real deaths / game over allowed).
for (const key of Object.keys(DIFFICULTIES) as DifficultyKey[]) {
  let over = 0;
  const rng = seeded(7);
  const e = new PacmanEngine({ difficulty: key, playerName: "TEST", highScore: 0, rng, onGameOver: () => over++ });
  e.godMode = false; // Keep exercising ordinary death/game-over behavior too.
  for (let i = 0; i < 60 * 240 && e.phase !== "gameOver"; i++) {
    if (i % 25 === 0) e.pressDir(DIR_PRIORITY[Math.floor(rng() * 4)]);
    e.update(1 / 60);
    if (i % 30 === 0) sanity(e, key);
  }
  console.log(`fuzz ${key.padEnd(9)} phase=${e.phase} score=${e.score} lives=${e.lives} pellets=${e.pelletsEaten} ghostsEaten=${e.ghostsEaten}`);
  check(e.lives >= 0, "lives negative");
}

// 2. Endless progression: clear every pellet on each level and let the real level-complete flow run.
{
  const e = new PacmanEngine({ difficulty: "OK_OK", playerName: "BOT", highScore: 0, rng: seeded(3) });
  e.godMode = true;
  const mazes: number[] = [e.params.mazeId];
  for (let guard = 0; e.level < 13 && guard < 20; guard++) {
    const lvl = e.level;
    for (let i = 0; i < 60 * 3 && e.phase !== "playing"; i++) e.update(1 / 60); // READY! -> playing
    for (let r = 0; r < 31; r++) for (let c = 0; c < COLS; c++) e.maze.eat(c, r);
    for (let i = 0; i < 60 * 6 && e.level === lvl; i++) { e.update(1 / 60); if (i === 30) check(e.phase === "levelComplete", `level ${lvl}: expected levelComplete, got ${e.phase}`); }
    check(e.level === lvl + 1, `level ${lvl} did not advance`);
    mazes.push(e.params.mazeId);
    sanity(e, `level ${e.level}`);
  }
  console.log(`endless: reached level ${e.level}; maze order ${mazes.join(",")}`);
  check(e.level === 13, "did not reach level 13");
  check(mazes.slice(0, 12).join() === "0,1,2,3,4,5,6,7,8,9,0,1", "maze rotation after level 10 is wrong");
  check(e.lives === 3, "lives should persist across levels");
  // Pac-Man can still play the new level.
  for (let i = 0; i < 60 * 5; i++) { if (i % 30 === 0) e.pressDir(DIR_PRIORITY[i % 4]); e.update(1 / 60); }
  check(e.phase === "playing", "level 13 not playable");
}

// 3. Ghost eaten -> returns to house -> regenerates -> leaves again.
{
  const e = new PacmanEngine({ difficulty: "OK_OK", playerName: "T", highScore: 0, rng: seeded(5) });
  e.godMode = true;
  for (let i = 0; i < 60 * 12; i++) e.update(1 / 60); // let everyone out
  const g = e.ghosts[2];
  g.state = "FRIGHTENED"; e.frightenedT = 6000;
  g.c = 13; g.r = 11; g.off = 0; g.dx = -1; g.dy = 0; g.x = 13.5; g.y = 11.5;
  const before = e.ghostsEaten;
  // teleport pac onto the ghost
  e.pac.c = 13; e.pac.r = 11; e.pac.off = 0; e.pac.dx = 0; e.pac.dy = 0;
  e.update(1 / 60);
  check(e.ghostsEaten === before + 1, "frightened ghost not eaten");
  let stages = new Set<string>();
  for (let i = 0; i < 60 * 30; i++) { e.update(1 / 60); stages.add(g.state); }
  console.log("eaten ghost stages:", [...stages].join(" -> "));
  check(stages.has("IN_GHOST_HOUSE") && (stages.has("CHASE") || stages.has("SCATTER") || stages.has("FRIGHTENED")), "eaten ghost did not return and re-leave");
}

// 3b. Score multiplier applies to pellets, power pellets, ghosts and fruit.
for (const key of Object.keys(DIFFICULTIES) as DifficultyKey[]) {
  const m = DIFFICULTIES[key].scoreMultiplier;
  const e = new PacmanEngine({ difficulty: key, playerName: "T", highScore: 0, rng: seeded(9) });
  const eat = (e as any).eatAt.bind(e) as (c: number, r: number) => void;
  eat(1, 1); check(e.score === Math.round(10 * m), `${key}: pellet should score ${10 * m}, got ${e.score}`);
  eat(1, 3); check(e.score === Math.round(10 * m) + Math.round(50 * m), `${key}: power pellet should add ${50 * m}`);
  const before = e.score;
  const g = e.ghosts[1]; g.state = "FRIGHTENED"; g.c = 13; g.r = 11; g.off = 0; g.dx = -1; g.dy = 0; g.x = 13.5; g.y = 11.5;
  e.pac.c = 13; e.pac.r = 11; e.pac.off = 0; e.pac.dx = 0; e.pac.dy = 0; (e as any).phase = "playing"; (e as any).checkCollisions();
  check(e.score - before === Math.round(200 * m), `${key}: first ghost should score ${200 * m}, got ${e.score - before}`);
  console.log(`score x${m} (${key}): pellet ${Math.round(10 * m)}, power ${Math.round(50 * m)}, ghost ${e.score - before}`);
}

// 3c. God Mode makes a normal chasing ghost edible without costing Pac-Man a life.
{
  const e = new PacmanEngine({ difficulty: "OK_OK", playerName: "GOD", highScore: 0, rng: seeded(11) });
  const g = e.ghosts[0];
  g.state = "CHASE"; g.c = 13; g.r = 11; g.off = 0; g.dx = -1; g.dy = 0; g.x = 13.5; g.y = 11.5;
  e.pac.c = 13; e.pac.r = 11; e.pac.off = 0; e.pac.dx = 0; e.pac.dy = 0;
  const lives = e.lives, score = e.score;
  (e as any).phase = "playing"; (e as any).checkCollisions();
  check(e.lives === lives, "God Mode collision should not cost a life");
  check((g.state as string) === "EATEN" && e.ghostsEaten === 1, "God Mode should eat a chasing ghost");
  check(e.score - score === 300, `God Mode first ghost should score 300 on OK OK, got ${e.score - score}`);
}

// 4. Endless scaling stays clamped and never goes negative.
for (const lvl of [1, 5, 10, 11, 25, 100, 1000]) {
  for (const key of Object.keys(DIFFICULTIES) as DifficultyKey[]) {
    const p = resolveParams(lvl, key);
    check(p.frightenedMs >= 1000 && p.ghostSpeed > 0 && p.ghostSpeed <= 7.2 * 1.15 + 1e-9 && p.releaseScale >= 0.25 && p.scatterMs >= 1500, `bad params L${lvl} ${key}`);
  }
}
check(getLevelConfig(11).mazeId === 0 && getLevelConfig(12).mazeId === 1, "maze rotation");
check(LEVELS.length === 10, "10 designed levels");
console.log("L1/L10/L11 ghost tiles/s (OK OK):", [1, 10, 11].map((l) => resolveParams(l, "OK_OK").ghostSpeed.toFixed(2)).join(" / "));

for (let i = 0; i < 10; i++) { const m = getMaze(i); check(m.totalPellets > 200, `maze ${i} pellets`); check(m.homeDist[11 * COLS + 13] === 0, `maze ${i} house entry`); }
console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll engine checks passed.");
process.exit(failures ? 1 : 0);
