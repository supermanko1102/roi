import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { desc, eq, sql } from "drizzle-orm";
import { createDb, etl_runs, type EtlRunMetrics } from "../db/client";

type Db = ReturnType<typeof createDb>["db"];

const CORE_TABLES = [
  "sale_deals", "presale_deals", "rent_deals", "projects", "buildings",
  "communities", "district_band_stats", "zone_band_stats",
] as const;

export async function latestSuccessfulMetrics(db: Db): Promise<EtlRunMetrics | null> {
  const [run] = await db.select({ metrics: etl_runs.metrics }).from(etl_runs)
    .where(eq(etl_runs.status, "success"))
    .orderBy(desc(etl_runs.completed_at))
    .limit(1);
  return run?.metrics ?? null;
}

export async function collectQualityMetrics(db: Db, fallbackHits?: number): Promise<EtlRunMetrics> {
  const { rows } = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM sale_deals) AS sale_deals,
      (SELECT count(*)::int FROM presale_deals) AS presale_deals,
      (SELECT count(*)::int FROM rent_deals) AS rent_deals,
      (SELECT count(*)::int FROM projects WHERE is_demo IS NOT TRUE) AS projects,
      (SELECT count(*)::int FROM buildings) AS buildings,
      (SELECT count(*)::int FROM communities) AS communities,
      (SELECT count(*)::int FROM district_band_stats) AS district_band_stats,
      (SELECT count(*)::int FROM zone_band_stats) AS zone_band_stats,
      (SELECT max(deal_date) FROM sale_deals) AS latest_sale,
      (SELECT max(deal_date) FROM presale_deals) AS latest_presale,
      (SELECT max(deal_date) FROM rent_deals) AS latest_rent,
      (SELECT count(*)::int FROM geocode_cache) AS geocode_total,
      (SELECT count(*)::int FROM geocode_cache WHERE precision IN ('door', 'cross')) AS geocode_precise,
      (SELECT count(*)::int FROM geocode_cache
       WHERE addr_key LIKE 'proj|%' AND precision IN ('door', 'cross')) AS project_precise,
      (SELECT count(*)::int FROM community_cases cc
       LEFT JOIN communities c ON c.case_no = cc.case_no WHERE c.case_no IS NULL) AS orphan_case_links,
      (SELECT count(*)::int FROM building_community bc
       LEFT JOIN communities c ON c.case_no = bc.case_no WHERE c.case_no IS NULL) AS orphan_building_cases,
      (SELECT count(*)::int FROM building_community bc
       LEFT JOIN physical_communities pc ON pc.id = bc.community_id
       WHERE bc.community_id IS NOT NULL AND pc.id IS NULL) AS orphan_entity_links
  `);
  const r = rows[0] as Record<string, unknown>;
  const date = (v: unknown) => v == null ? null : String(v).slice(0, 10);
  return {
    tables: Object.fromEntries(CORE_TABLES.map((name) => [name, Number(r[name])])),
    latest_deals: {
      sale: date(r.latest_sale), presale: date(r.latest_presale), rent: date(r.latest_rent),
    },
    geocode: {
      total: Number(r.geocode_total), precise: Number(r.geocode_precise),
      project_precise: Number(r.project_precise),
      ...(fallbackHits == null ? {} : { fallback_hits: fallbackHits }),
    },
    integrity: {
      orphan_case_links: Number(r.orphan_case_links),
      orphan_building_cases: Number(r.orphan_building_cases),
      orphan_entity_links: Number(r.orphan_entity_links),
    },
    warnings: [],
  };
}

export function evaluateQuality(current: EtlRunMetrics, previous: EtlRunMetrics | null) {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const table of CORE_TABLES) {
    const count = current.tables[table] ?? 0;
    if (count <= 0) errors.push(`${table} 為 0 筆`);
    const before = previous?.tables[table] ?? 0;
    if (before > 0 && count < before * 0.7)
      errors.push(`${table} 從 ${before} 降至 ${count}（跌幅超過 30%）`);
  }
  for (const source of ["sale", "presale", "rent"]) {
    const now = current.latest_deals[source];
    const before = previous?.latest_deals[source];
    if (before && (!now || now < before)) errors.push(`${source} 最新成交日由 ${before} 倒退為 ${now ?? "無"}`);
  }
  const ratio = current.geocode.total > 0 ? current.geocode.precise / current.geocode.total : 0;
  const previousRatio = previous && previous.geocode.total > 0
    ? previous.geocode.precise / previous.geocode.total : null;
  if (previousRatio != null && ratio < previousRatio - 0.1)
    warnings.push(`geocode 精確率由 ${(previousRatio * 100).toFixed(1)}% 降至 ${(ratio * 100).toFixed(1)}%`);
  for (const [name, count] of Object.entries(current.integrity))
    if (count > 0) errors.push(`${name} 有 ${count} 筆孤兒關聯`);
  current.warnings = warnings;
  return { errors, warnings };
}

export function writeActionsSummary(metrics: EtlRunMetrics, errors: string[], warnings: string[]) {
  const target = process.env.GITHUB_STEP_SUMMARY;
  if (!target) return;
  const rows = Object.entries(metrics.tables).map(([name, count]) => `| ${name} | ${count} |`).join("\n");
  fs.appendFileSync(target, [
    "## ETL 資料品質\n",
    "| 資料表 | 筆數 |", "|---|---:|", rows,
    `\n- 最新成交：中古 ${metrics.latest_deals.sale ?? "—"}、預售 ${metrics.latest_deals.presale ?? "—"}、租賃 ${metrics.latest_deals.rent ?? "—"}`,
    `- Geocode：精確 ${metrics.geocode.precise}/${metrics.geocode.total}、建案 ${metrics.geocode.project_precise}、fallback ${metrics.geocode.fallback_hits ?? "—"}`,
    `- 關聯完整性：case ${metrics.integrity.orphan_case_links}、building case ${metrics.integrity.orphan_building_cases}、entity ${metrics.integrity.orphan_entity_links}`,
    ...(warnings.length ? ["\n### 警告", ...warnings.map((w) => `- ${w}`)] : []),
    ...(errors.length ? ["\n### 失敗", ...errors.map((e) => `- ${e}`)] : []),
    "\n",
  ].join("\n"));
}

async function main() {
  const { db, pool } = createDb();
  const previous = await latestSuccessfulMetrics(db);
  const metrics = await collectQualityMetrics(db);
  const { errors, warnings } = evaluateQuality(metrics, previous);
  writeActionsSummary(metrics, errors, warnings);
  console.log(JSON.stringify({ metrics, errors, warnings }, null, 2));
  await pool.end();
  if (errors.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((e) => { console.error(e); process.exit(1); });
