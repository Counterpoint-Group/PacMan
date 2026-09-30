import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store, max-age=0" };

/** Lightweight liveness check for Render and external uptime monitors. */
export function GET() {
  return NextResponse.json(
    { status: "ok", service: "pacman-arcade", timestamp: new Date().toISOString() },
    { status: 200, headers },
  );
}

export function HEAD() {
  return new Response(null, { status: 200, headers });
}
