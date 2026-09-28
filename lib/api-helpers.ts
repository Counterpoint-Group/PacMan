import "server-only";
import { NextResponse } from "next/server";

export class DbError extends Error {}

export const jsonError = (message: string, status: number) => NextResponse.json({ error: message }, { status });

/** Convert thrown errors into safe JSON responses (never leak internals or secrets). */
export function handleError(err: unknown): NextResponse {
  if (err instanceof DbError) return jsonError("The arcade database is unavailable. Please try again.", 503);
  console.error("[api]", err);
  const msg = err instanceof Error && /must be set/.test(err.message) ? "The arcade server is not configured yet." : "Unexpected server error.";
  return jsonError(msg, 500);
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
