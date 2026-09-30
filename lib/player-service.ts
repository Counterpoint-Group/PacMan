import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { DbError } from "./api-helpers";
import { getSupabase } from "./supabase-server";
import { DIFFICULTY_LABELS } from "./types";
import type {
  CompleteGameRequest, CompleteGameResponse, DifficultyLabel, LeaderboardEntry, LeaderboardFilter, LeaderboardResponse,
  PlayerExtraStats, PlayerProfile, PublicPlayer,
} from "./types";

/** All database access lives here. UI components never talk to Supabase. */
function dbFail(context: string, error: unknown): never {
  console.error(`[db] ${context}:`, error);
  throw new DbError(context);
}

interface PlayerRow {
  id: string; name: string; department: string | null; high_score: number; highest_level: number;
  best_difficulty: DifficultyLabel | null; total_games: number; last_played: string | null;
}
const PROFILE_COLUMNS = "id,name,department,high_score,highest_level,best_difficulty,total_games,last_played";

const toProfile = (r: PlayerRow): PlayerProfile => ({
  id: r.id, name: r.name, department: r.department, highScore: r.high_score, highestLevel: r.highest_level,
  totalGames: r.total_games, bestDifficulty: r.best_difficulty, lastPlayed: r.last_played,
});

export class PlayerNameTakenError extends Error {}

/** Create a workshop player. A database index enforces case-insensitive name uniqueness. */
export async function createPlayer(name: string, playerCode: string, department: string | null): Promise<PlayerProfile> {
  const { data, error } = await getSupabase().from("players").insert({
    name,
    player_code: playerCode,
    department,
  }).select(PROFILE_COLUMNS).single();
  if (error?.code === "23505") throw new PlayerNameTakenError(name);
  if (error) dbFail("createPlayer", error);
  return toProfile(data as PlayerRow);
}

/** Safe list for the "WHO'S PLAYING?" selector. Never includes player_code. */
export async function getPlayers(): Promise<PublicPlayer[]> {
  const { data, error } = await getSupabase().from("players").select("id,name,department").order("name", { ascending: true }).limit(5000);
  if (error) dbFail("getPlayers", error);
  return (data ?? []) as PublicPlayer[];
}

export async function getPlayer(playerId: string): Promise<PlayerProfile | null> {
  const { data, error } = await getSupabase().from("players").select(PROFILE_COLUMNS).eq("id", playerId).maybeSingle();
  if (error) dbFail("getPlayer", error);
  return data ? toProfile(data as PlayerRow) : null;
}

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Returns the player's profile if the code matches, otherwise null (callers must not say why). */
export async function verifyPlayerCode(playerId: string, playerCode: string): Promise<PlayerProfile | null> {
  const { data, error } = await getSupabase().from("players").select(`${PROFILE_COLUMNS},player_code`).eq("id", playerId).maybeSingle();
  if (error) dbFail("verifyPlayerCode", error);
  const row = data as (PlayerRow & { player_code: string }) | null;
  const expected = row?.player_code ?? "\u0000no-such-player\u0000";
  const match = timingSafeEqual(digest(expected), digest(playerCode.trim()));
  if (!row || !match) return null;
  const { player_code: _omit, ...safe } = row; // never leaves this function
  void _omit;
  return toProfile(safe);
}

export async function getPlayerExtraStats(playerId: string): Promise<PlayerExtraStats> {
  const { data, error } = await getSupabase().from("game_history").select("score,pellets_eaten,ghosts_eaten").eq("player_id", playerId).limit(10000);
  if (error) dbFail("getPlayerExtraStats", error);
  const rows = (data ?? []) as { score: number; pellets_eaten: number; ghosts_eaten: number }[];
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0);
  return {
    averageScore: rows.length ? Math.round(sum((r) => r.score) / rows.length) : 0,
    totalGhostsEaten: sum((r) => r.ghosts_eaten),
    totalPelletsEaten: sum((r) => r.pellets_eaten),
  };
}

// ---- leaderboard -------------------------------------------------------------------

const KEY_TO_LABEL: Record<"EASY" | "OK_OK" | "NIGHTMARE", DifficultyLabel> = { EASY: "EASY", OK_OK: "OK OK", NIGHTMARE: "NIGHTMARE" };
const TOP_N = 25;

type Unranked = Omit<LeaderboardEntry, "rank">;

function rankEntries(rows: Unranked[], filter: LeaderboardFilter): LeaderboardEntry[] {
  const byLevel = filter === "LEVEL";
  rows.sort((a, b) =>
    byLevel
      ? b.highestLevel - a.highestLevel || b.highScore - a.highScore || a.name.localeCompare(b.name)
      : b.highScore - a.highScore || b.highestLevel - a.highestLevel || a.name.localeCompare(b.name));
  let rank = 0;
  return rows.map((r, i) => {
    const prev = rows[i - 1];
    const tied = prev && (byLevel ? prev.highestLevel === r.highestLevel && prev.highScore === r.highScore : prev.highScore === r.highScore && prev.highestLevel === r.highestLevel);
    if (!tied) rank = i + 1;
    return { ...r, rank };
  });
}

export async function getLeaderboard(filter: LeaderboardFilter, viewerId: string | null): Promise<LeaderboardResponse> {
  const db = getSupabase();
  let rows: Unranked[];

  if (filter === "OVERALL" || filter === "LEVEL") {
    const totals = new Map<string, { pelletsEaten: number; ghostsEaten: number }>();
    const { data: historyRows, error: historyError } = await db.from("game_history").select("player_id,pellets_eaten,ghosts_eaten").limit(50000);
    if (historyError) dbFail("getLeaderboard(game_history totals)", historyError);
    for (const r of (historyRows ?? []) as { player_id: string; pellets_eaten: number; ghosts_eaten: number }[]) {
      const current = totals.get(r.player_id) ?? { pelletsEaten: 0, ghostsEaten: 0 };
      current.pelletsEaten += r.pellets_eaten;
      current.ghostsEaten += r.ghosts_eaten;
      totals.set(r.player_id, current);
    }

    const { data, error } = await db.from("players").select("id,name,department,high_score,highest_level,best_difficulty").or("total_games.gt.0,high_score.gt.0").limit(5000);
    if (error) dbFail("getLeaderboard(players)", error);
    rows = ((data ?? []) as PlayerRow[]).map((p) => ({
      playerId: p.id, name: p.name, department: p.department, highScore: p.high_score, highestLevel: p.highest_level,
      ghostsEaten: totals.get(p.id)?.ghostsEaten ?? 0, pelletsEaten: totals.get(p.id)?.pelletsEaten ?? 0, bestDifficulty: p.best_difficulty,
    }));
  } else {
    const label = KEY_TO_LABEL[filter];
    const totals = new Map<string, { pelletsEaten: number; ghostsEaten: number }>();
    const { data: historyRows, error: historyError } = await db.from("game_history").select("player_id,pellets_eaten,ghosts_eaten,difficulty").eq("difficulty", label).limit(50000);
    if (historyError) dbFail("getLeaderboard(filtered history totals)", historyError);
    for (const r of (historyRows ?? []) as { player_id: string; pellets_eaten: number; ghosts_eaten: number; difficulty: string }[]) {
      const current = totals.get(r.player_id) ?? { pelletsEaten: 0, ghostsEaten: 0 };
      current.pelletsEaten += r.pellets_eaten;
      current.ghostsEaten += r.ghosts_eaten;
      totals.set(r.player_id, current);
    }

    const { data, error } = await db.from("game_history").select("player_id,score,level_reached,players!inner(name,department),pellets_eaten,ghosts_eaten").eq("difficulty", label).order("score", { ascending: false }).limit(5000);
    if (error) dbFail("getLeaderboard(history)", error);
    const best = new Map<string, Unranked>();
    for (const r of (data ?? []) as unknown as { player_id: string; score: number; level_reached: number; pellets_eaten: number; ghosts_eaten: number; players: { name: string; department: string | null } | { name: string; department: string | null }[] }[]) {
      const p = Array.isArray(r.players) ? r.players[0] : r.players;
      const cur = best.get(r.player_id);
      if (!cur) {
        best.set(r.player_id, {
          playerId: r.player_id, name: p.name, department: p.department, highScore: r.score, highestLevel: r.level_reached,
          ghostsEaten: totals.get(r.player_id)?.ghostsEaten ?? 0, pelletsEaten: totals.get(r.player_id)?.pelletsEaten ?? 0, bestDifficulty: label,
        });
      } else {
        cur.highestLevel = Math.max(cur.highestLevel, r.level_reached);
        cur.ghostsEaten = totals.get(r.player_id)?.ghostsEaten ?? cur.ghostsEaten;
        cur.pelletsEaten = totals.get(r.player_id)?.pelletsEaten ?? cur.pelletsEaten;
      }
    }
    rows = [...best.values()];
  }

  const ranked = rankEntries(rows, filter);
  return {
    filter,
    entries: ranked.slice(0, TOP_N),
    me: viewerId ? ranked.find((e) => e.playerId === viewerId) ?? null : null,
    totalPlayers: ranked.length,
  };
}

// ---- completed games ---------------------------------------------------------------

/** Insert the game, then update the player's personal bests. Safe to retry (idempotent per clientGameId). */
export async function recordCompletedGame(playerId: string, input: CompleteGameRequest): Promise<CompleteGameResponse> {
  const db = getSupabase();
  const { data: current, error: readError } = await db.from("players").select(PROFILE_COLUMNS).eq("id", playerId).maybeSingle();
  if (readError) dbFail("recordCompletedGame(read player)", readError);
  if (!current) throw new DbError("player not found");
  const player = current as PlayerRow;

  const { error: insertError } = await db.from("game_history").insert({
    player_id: playerId, score: input.score, level_reached: input.levelReached, difficulty: input.difficulty,
    pellets_eaten: input.pelletsEaten, ghosts_eaten: input.ghostsEaten, duration_seconds: input.durationSeconds, client_game_id: input.clientGameId,
  });
  const duplicate = insertError?.code === "23505"; // this exact game was already saved (a retry)
  if (insertError && !duplicate) dbFail("recordCompletedGame(insert)", insertError);

  const profile = await updatePlayerStats(player, input, duplicate);
  return {
    profile,
    isNewHighScore: duplicate ? player.high_score === input.score && input.score > 0 : input.score > player.high_score,
    isNewHighestLevel: !duplicate && input.levelReached > player.highest_level,
  };
}

/** Personal bests only ever go up. total_games is reconciled against game_history so retries can't drift. */
export async function updatePlayerStats(player: PlayerRow, input: CompleteGameRequest, alreadyCounted: boolean): Promise<PlayerProfile> {
  const db = getSupabase();
  const { count, error: countError } = await db.from("game_history").select("id", { count: "exact", head: true }).eq("player_id", player.id);
  if (countError) dbFail("updatePlayerStats(count)", countError);

  const update: Record<string, unknown> = {
    total_games: Math.max(player.total_games + (alreadyCounted ? 0 : 1), count ?? 0),
    last_played: new Date().toISOString(),
  };
  if (input.score > player.high_score) { update.high_score = input.score; update.best_difficulty = input.difficulty; }
  if (input.levelReached > player.highest_level) update.highest_level = input.levelReached;

  const { data, error } = await db.from("players").update(update).eq("id", player.id).select(PROFILE_COLUMNS).single();
  if (error) dbFail("updatePlayerStats(update)", error);
  return toProfile(data as PlayerRow);
}

export const isDifficulty = (v: unknown): v is DifficultyLabel => typeof v === "string" && (DIFFICULTY_LABELS as string[]).includes(v);
