import { NextRequest, NextResponse } from "next/server";
import { createPlayer, PlayerNameTakenError } from "@/lib/player-service";
import { setSessionCookie } from "@/lib/player-session";
import { handleError, jsonError } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

const USERNAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._'’\-]*$/u;

/** POST /api/player/register -> creates a unique workshop player and signs them in. */
export async function POST(req: NextRequest) {
  let body: { username?: unknown; playerCode?: unknown; department?: unknown };
  try { body = await req.json(); } catch { return jsonError("Invalid request.", 400); }

  const username = typeof body.username === "string" ? body.username.trim().replace(/\s+/g, " ") : "";
  const playerCode = typeof body.playerCode === "string" ? body.playerCode.trim() : "";
  const department = typeof body.department === "string" ? body.department.trim().replace(/\s+/g, " ") : "";

  if (username.length < 2 || username.length > 24 || !USERNAME_RE.test(username)) {
    return jsonError("Username must be 2–24 characters and use letters, numbers, spaces, dots, dashes or underscores.", 400);
  }
  if (playerCode.length < 4 || playerCode.length > 32) {
    return jsonError("Player Code must be 4–32 characters.", 400);
  }
  if (department.length > 50) return jsonError("Team or group must be 50 characters or fewer.", 400);

  try {
    const player = await createPlayer(username, playerCode, department || null);
    const res = NextResponse.json({ player }, { status: 201 });
    setSessionCookie(res, player.id);
    return res;
  } catch (err) {
    if (err instanceof PlayerNameTakenError) return jsonError("That username is already taken. Choose another one.", 409);
    return handleError(err);
  }
}
