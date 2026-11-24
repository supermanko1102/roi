import type { MetadataRoute } from "next";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { CITY_NAMES } from "@/lib/cities";
import { projectPath, siteUrl } from "@/lib/project-url";

// 請求時才查 DB:build 階段不依賴資料庫連線
export const dynamic = "force-dynamic";

// 只收成交滿 3 筆的建案:一兩筆的案內容太薄(多為透天單戶編號),不值得被索引
const MIN_DEALS = 3;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const rows = (await db.execute(sql`
    SELECT pj.city, pj.district, pj.name FROM projects pj
    WHERE pj.is_demo IS NOT TRUE AND coalesce(pj.deal_count, 0) >= ${MIN_DEALS}
    ORDER BY pj.deal_count DESC
  `)).rows as { city: string; district: string; name: string }[];
  return [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    ...rows
      .filter((r) => CITY_NAMES.includes(r.city) && !/[?�]/.test(r.name))
      .map((r) => ({
        url: `${base}${projectPath(r.city, r.district, r.name)}`,
        changeFrequency: "weekly" as const, priority: 0.6,
      })),
  ];
}
