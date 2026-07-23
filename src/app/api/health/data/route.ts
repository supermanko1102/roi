import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, etl_runs } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const [run] = await db.select({
    id: etl_runs.id, git_sha: etl_runs.git_sha,
    completed_at: etl_runs.completed_at, metrics: etl_runs.metrics,
  }).from(etl_runs)
    .where(eq(etl_runs.status, "success"))
    .orderBy(desc(etl_runs.completed_at))
    .limit(1);
  if (!run) return NextResponse.json({ status: "unavailable" }, { status: 503 });
  const completedAt = run.completed_at?.getTime() ?? 0;
  const stale = Date.now() - completedAt > 15 * 24 * 60 * 60 * 1000;
  return NextResponse.json({ status: stale ? "stale" : "ok", ...run }, {
    status: stale ? 503 : 200,
    headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
  });
}
