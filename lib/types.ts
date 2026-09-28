/** Types shared by the browser and the server. Nothing in here is sensitive (no player codes). */
import type { DifficultyLabel } from "../game/constants";
export type { DifficultyLabel };

export const DIFFICULTY_LABELS: DifficultyLabel[] = ["EASY", "OK OK", "NIGHTMARE"];

export interface PublicPlayer { id: string; name: string; department: string | null }

export interface PlayerProfile {
  id: string;
  name: string;
  department: string | null;
  highScore: number;
  highestLevel: number;
  totalGames: number;
  bestDifficulty: DifficultyLabel | null;
  lastPlayed: string | null;
}

export interface PlayerExtraStats { averageScore: number; totalGhostsEaten: number; totalPelletsEaten: number }

export type LeaderboardFilter = "OVERALL" | "EASY" | "OK_OK" | "NIGHTMARE" | "LEVEL";
export const LEADERBOARD_FILTERS: LeaderboardFilter[] = ["OVERALL", "EASY", "OK_OK", "NIGHTMARE", "LEVEL"];

export interface LeaderboardEntry {
  rank: number;
  playerId: string;
  name: string;
  department: string | null;
  highScore: number;
  highestLevel: number;
  ghostsEaten: number;
  pelletsEaten: number;
  bestDifficulty: DifficultyLabel | null;
}

export interface LeaderboardResponse {
  filter: LeaderboardFilter;
  entries: LeaderboardEntry[];
  me: LeaderboardEntry | null;
  totalPlayers: number;
}

export interface CompleteGameRequest {
  score: number;
  levelReached: number;
  difficulty: DifficultyLabel;
  pelletsEaten: number;
  ghostsEaten: number;
  durationSeconds: number;
  clientGameId: string;
}

export interface CompleteGameResponse { profile: PlayerProfile; isNewHighScore: boolean; isNewHighestLevel: boolean }
