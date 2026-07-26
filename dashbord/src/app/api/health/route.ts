import { db } from "@/db";
import { sql } from "drizzle-orm";
import type { HealthResponse } from "@/lib/robot/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — structured liveness probe.
 * Reports database reachability and probe latency so operators can
 * distinguish "app is up" from "app is up but the DB is gone".
 */
export async function GET(): Promise<Response> {
  const startedAt = performance.now();

  try {
    await db.execute(sql`select 1`);

    const body: HealthResponse = {
      ok: true,
      service: "mission-control",
      database: "up",
      latencyMs: Math.round(performance.now() - startedAt),
      timestamp: new Date().toISOString(),
    };
    return Response.json(body);
  } catch (error) {
    const body: HealthResponse = {
      ok: false,
      service: "mission-control",
      database: "down",
      latencyMs: Math.round(performance.now() - startedAt),
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Unknown database error",
    };
    return Response.json(body, { status: 503 });
  }
}
