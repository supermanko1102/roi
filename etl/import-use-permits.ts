/**
 * 使用執照匯入(雙北開放資料)→ use_permits(逐市整批重建)
 *
 * 資料源(桃園市無使照開放資料,無 adapter,維持備查+首次登記推屋齡):
 *   臺北市:data.taipei「歷年使照摘要」單一 XML(~65MB,年更)
 *     欄位:執照號碼/發照日期/原核發執照(=建照號碼)/竣工日期/建築地點>地址(多筆取第一)
 *   新北市:data.ntpc「建築執照存查」(實為使照存根,季更,分頁 JSON)
 *     欄位:license_number/date_licensing/original_construction_lic/house_address
 *
 * permit_no_norm:全形轉半形、去空白、年度與序號去前導零(「088建字第0221號」→「88建字第221號」),
 * 與 communities.permit_no 同法正規化後即可 join(join 在 match-communities 做)。
 * 用法:tsx etl/import-use-permits.ts [--city 臺北市] [--refresh]
 *   不帶 --city 時跑 CITIES ∩ 有 adapter 的城市(桃園 no-op)。
 */
import fs from "node:fs";
import path from "node:path";
import { count, eq } from "drizzle-orm";
import { createDb, use_permits } from "../db/client";
import { CITIES } from "../src/lib/cities";
import { normPermitNo } from "./addr";
import { assertReplacementSafe } from "./replacement-safety";

const CACHE_DIR = path.join(import.meta.dirname, "downloads", "use-permits");
const BATCH = 500;

const rocDate = (s?: string | null): string | null => {
  if (!s || !/^\d{6,7}$/.test(s.trim())) return null;
  const p = s.trim().padStart(7, "0");
  const y = +p.slice(0, 3) + 1911, m = p.slice(3, 5), d = p.slice(5, 7);
  return m === "00" || d === "00" || +m > 12 ? null : `${y}-${m}-${d}`;
};

type PermitRow = typeof use_permits.$inferInsert;

async function fetchCached(url: string, cacheFile: string, refresh: boolean): Promise<string> {
  const p = path.join(CACHE_DIR, cacheFile);
  if (!refresh && fs.existsSync(p)) return fs.readFileSync(p, "utf-8");
  console.log(`  下載 ${url}`);
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const text = await res.text();
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(p, text);
  return text;
}

const tag = (block: string, name: string): string | null =>
  block.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1]?.trim() || null;

// ---- 臺北市:單一 XML,逐 <Data> 區塊 regex 解析(65MB 可整檔進記憶體,免 XML parser 依賴) ----
async function taipei(refresh: boolean): Promise<PermitRow[]> {
  const RID = "0f3f9675-8356-4f1a-9908-1ce8892012fa"; // dataset c876ff02-…
  const xml = await fetchCached(
    `https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=${RID}`,
    "taipei-use-permits.xml", refresh);
  const rows: PermitRow[] = [];
  for (const m of xml.matchAll(/<Data>([\s\S]*?)<\/Data>/g)) {
    const b = m[1];
    const license = tag(b, "執照號碼");
    if (!license) continue;
    rows.push({
      city: "臺北市",
      license_no: license,
      permit_no_norm: normPermitNo(tag(b, "原核發執照")),
      issue_date: rocDate(tag(b, "發照日期")),
      complete_date: rocDate(tag(b, "竣工日期")),
      address: tag(b, "地址"),
      source: "data.taipei 歷年使照摘要",
    });
  }
  return rows;
}

// ---- 新北市:分頁 JSON API ----
async function newTaipei(refresh: boolean): Promise<PermitRow[]> {
  const ID = "c1487d7b-fff1-43d3-a2ce-4716eab4d286";
  const rows: PermitRow[] = [];
  for (let page = 0; ; page++) {
    const text = await fetchCached(
      `https://data.ntpc.gov.tw/api/datasets/${ID}/json?page=${page}&size=1000`,
      `ntpc-use-permits-p${page}.json`, refresh);
    const list = JSON.parse(text);
    if (!Array.isArray(list) || list.length === 0) break;
    for (const r of list) {
      if (!r.license_number) continue;
      rows.push({
        city: "新北市",
        license_no: r.license_number,
        permit_no_norm: normPermitNo(r.original_construction_lic),
        issue_date: rocDate(r.date_licensing),
        complete_date: rocDate(r.completion_date),
        address: r.house_address || null,
        source: "data.ntpc 建築執照存查",
      });
    }
    if (list.length < 1000) break;
  }
  return rows;
}

const ADAPTERS: Record<string, (refresh: boolean) => Promise<PermitRow[]>> = {
  "臺北市": taipei,
  "新北市": newTaipei,
};

async function main() {
  const args = process.argv.slice(2);
  const refresh = args.includes("--refresh");
  const allowEmpty = args.includes("--allow-empty");
  const cityArg = args.includes("--city") ? args[args.indexOf("--city") + 1] : null;
  const targets = cityArg ? [cityArg] : CITIES.map((c) => c.name).filter((n) => ADAPTERS[n]);
  if (!targets.length) { console.log("[use-permits] 啟用城市皆無使照資料源,略過"); return; }

  const { db, pool } = createDb();
  for (const city of targets) {
    const adapter = ADAPTERS[city];
    if (!adapter) { console.warn(`[use-permits] ${city} 無 adapter,略過`); continue; }
    console.log(`[use-permits] ${city}`);
    const rows = await adapter(refresh);
    // 同一使照號碼在來源重複時保留第一筆
    const seen = new Set<string>();
    const uniq = rows.filter((r) => !seen.has(r.license_no) && (seen.add(r.license_no), true));
    const [{ n: previous }] = await db.select({ n: count() }).from(use_permits)
      .where(eq(use_permits.city, city));
    assertReplacementSafe(`[use-permits] ${city}`, previous, uniq.length, allowEmpty);
    await db.transaction(async (tx) => {
      await tx.delete(use_permits).where(eq(use_permits.city, city));
      for (let i = 0; i < uniq.length; i += BATCH)
        await tx.insert(use_permits).values(uniq.slice(i, i + BATCH));
    });
    const withPermit = uniq.filter((r) => r.permit_no_norm).length;
    console.log(`[use-permits] ${city} ${uniq.length} 張使照(${withPermit} 張帶建照號碼,` +
      `${(withPermit / Math.max(1, uniq.length) * 100).toFixed(1)}%)`);
  }
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
