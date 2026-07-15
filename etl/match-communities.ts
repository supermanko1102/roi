/**
 * 社區歸戶:把中古門牌對回預售建案名稱(樂居式「社區名」的資料基礎)
 *
 * 原理:實登 2.0 的「預售備查建案」有 建案名稱↔坐落地號;中古買賣的 a_land 附檔
 * 有 每筆交易↔坐落地號。兩邊用「區|段名|母號-子號」交集,即可把門牌歸到建案。
 * 只有 110 年(2021)實登 2.0 後備查的建案有資料,更老的社區不會有名字——與樂居同限制。
 *
 * 資料源:
 *   plvr「預售備查建案下載」lvr_buildcasecsv.zip → h_lvr_buildcase / h_lvr_buildingland
 *     (自動下載到 etl/downloads/buildcase/,--refresh 強制重抓)
 *   etl/downloads/{season}/h_lvr_land_a.csv(交易編號↔門牌)
 *   etl/downloads/{season}/h_lvr_land_a_land.csv(交易編號↔段名+地號;舊期別缺檔會跳過,
 *     先跑 pnpm etl:download <季別> 補齊)
 *
 * 防呆:同門牌命中多建案取地號交集數最多者;buildings.build_year 與建案
 * 第1次登記年差 > 4 年者不配(避免重劃重編地號誤配到舊屋)。
 * 寫入:communities、building_community(整批重建,可重複執行)。
 */
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";
import { sql } from "drizzle-orm";
import { createDb, communities, building_community } from "../db/client";

const DL = path.join(import.meta.dirname, "downloads");
const CASE_DIR = path.join(DL, "buildcase");
const CASE_ZIP_URL = "https://plvr.land.moi.gov.tw/Download?type=zip&PayType=saleremark&fileName=lvr_buildcasecsv.zip";
const CASE_FILES = ["h_lvr_buildcase.csv", "h_lvr_buildingland.csv"];
const MAX_YEAR_GAP = 4;
const BATCH = 500;

const rocDate = (s?: string): string | null => {
  if (!s || !/^\d{6,7}$/.test(s)) return null;
  const p = s.padStart(7, "0");
  const y = +p.slice(0, 3) + 1911, m = p.slice(3, 5), d = p.slice(5, 7);
  return m === "00" || d === "00" ? null : `${y}-${m}-${d}`;
};
const col = (headers: string[], ...keys: string[]) =>
  headers.findIndex((h) => keys.every((k) => h.includes(k)));

function readCsv(file: string): string[][] {
  let text = fs.readFileSync(file, "utf-8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = parse(text, { relax_column_count: true, skip_empty_lines: true });
  return rows.filter((_, i) => i !== 1); // 第 2 列是英文表頭
}

// 「聖亭段305地號」「大湳段二小段12-3地號」→ 段名 + 母-子
function parseParcelText(s: string): { sec: string; no: string } | null {
  const m = s.trim().match(/^(.+段)(\d+)(?:[-之](\d+))?地號$/);
  return m ? { sec: m[1], no: `${+m[2]}-${+(m[3] ?? 0)}` } : null;
}
// a_land 的 8 碼地號「04800026」→ 480-26
function parseParcelCode(code: string): string | null {
  const m = code.trim().match(/^(\d{4})(\d{4})$/);
  return m ? `${+m[1]}-${+m[2]}` : null;
}

async function ensureCaseFiles(refresh: boolean) {
  if (!refresh && CASE_FILES.every((f) => fs.existsSync(path.join(CASE_DIR, f)))) return;
  console.log(`[communities] 下載建案備查 <- ${CASE_ZIP_URL}`);
  const res = await fetch(CASE_ZIP_URL, {
    headers: { "User-Agent": "Mozilla/5.0", Referer: "https://plvr.land.moi.gov.tw/DownloadOpenData" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));
  fs.mkdirSync(CASE_DIR, { recursive: true });
  for (const entry of zip.getEntries()) {
    const name = entry.entryName.toLowerCase();
    if (CASE_FILES.includes(name)) fs.writeFileSync(path.join(CASE_DIR, name), entry.getData());
  }
}

async function main() {
  const refresh = process.argv.includes("--refresh");
  await ensureCaseFiles(refresh);
  const { db, pool } = createDb();

  // ---- 建案側:case → 基本資料 + 地號集合 ----
  type CaseInfo = typeof communities.$inferInsert;
  const cases = new Map<string, CaseInfo>();
  {
    const [h, ...rows] = readCsv(path.join(CASE_DIR, "h_lvr_buildcase.csv"));
    const iDist = col(h, "鄉鎮市區"), iName = col(h, "建案名稱"), iStreet = col(h, "坐落街道");
    const iHh = col(h, "層棟戶數"), iPermit = col(h, "建造執照"), iReg = col(h, "第1次登記");
    const iDecl = col(h, "申報備查"), iNo = col(h, "編號");
    for (const r of rows) {
      const case_no = r[iNo]?.trim();
      if (!case_no || !r[iName]) continue;
      const hhm = (r[iHh] ?? "").match(/(\d+)戶/) ?? (r[iHh] ?? "").match(/^(\d+)$/);
      cases.set(case_no, {
        case_no, name: r[iName].trim(), district: r[iDist],
        households: hhm ? +hhm[1] : null,
        street: r[iStreet] || null, permit_no: r[iPermit] || null,
        first_reg: rocDate(r[iReg]), declare_date: rocDate(r[iDecl]),
      });
    }
  }
  const parcelToCases = new Map<string, string[]>();
  {
    const [h, ...rows] = readCsv(path.join(CASE_DIR, "h_lvr_buildingland.csv"));
    const iNo = col(h, "編號"), iLand = col(h, "土地位置");
    for (const r of rows) {
      const c = cases.get(r[iNo]?.trim());
      const p = parseParcelText(r[iLand] ?? "");
      if (!c || !p) continue;
      const key = `${c.district}|${p.sec}|${p.no}`;
      (parcelToCases.get(key) ?? parcelToCases.set(key, []).get(key)!).push(c.case_no);
    }
  }

  // ---- 交易側:addr_key → 地號集合(掃所有期別) ----
  const addrParcels = new Map<string, Set<string>>();
  let seasonsUsed = 0;
  for (const season of fs.readdirSync(DL)) {
    const aFile = path.join(DL, season, "h_lvr_land_a.csv");
    const landFile = path.join(DL, season, "h_lvr_land_a_land.csv");
    if (!fs.existsSync(aFile) || !fs.existsSync(landFile)) {
      if (fs.existsSync(aFile)) console.warn(`  [warn] ${season} 缺 a_land.csv,先 pnpm etl:download ${season} 補齊`);
      continue;
    }
    seasonsUsed++;
    const serials = new Map<string, { addr_key: string; district: string }>();
    {
      const [h, ...rows] = readCsv(aFile);
      const iDist = col(h, "鄉鎮市區"), iAddr = col(h, "土地位置"), iNo = col(h, "編號");
      for (const r of rows) {
        const addr = r[iAddr] ?? "";
        // 純土地交易的位置是「○○段690地號」,不是門牌,跳過
        if (!addr.includes("號") || /地號/.test(addr) || !r[iNo]) continue;
        serials.set(r[iNo], { addr_key: addr.replace(/號.*$/, "號"), district: r[iDist] });
      }
    }
    const [h, ...rows] = readCsv(landFile);
    const iNo = col(h, "編號"), iSec = col(h, "土地位置"), iCode = col(h, "地號");
    for (const r of rows) {
      const s = serials.get(r[iNo]);
      const sec = (r[iSec] ?? "").trim();
      const no = parseParcelCode(r[iCode] ?? "");
      if (!s || !sec.endsWith("段") || !no) continue;
      const key = `${s.district}|${sec}|${no}`;
      (addrParcels.get(s.addr_key) ?? addrParcels.set(s.addr_key, new Set()).get(s.addr_key)!).add(key);
    }
  }
  console.log(`[communities] 建案 ${cases.size} 個(${parcelToCases.size} 筆地號)、` +
    `門牌 ${addrParcels.size} 個(掃 ${seasonsUsed} 期)`);

  // ---- 歸戶:地號交集數最多者勝,屋齡與完工年差過大者剔除 ----
  const { rows: byRows } = await db.execute(sql`SELECT addr_key, build_year FROM buildings`);
  const buildYear = new Map((byRows as { addr_key: string; build_year: number | null }[])
    .map((r) => [r.addr_key, r.build_year]));

  const assignments: (typeof building_community.$inferInsert)[] = [];
  for (const [addr_key, parcels] of addrParcels) {
    const hits = new Map<string, number>();
    for (const p of parcels)
      for (const c of parcelToCases.get(p) ?? []) hits.set(c, (hits.get(c) ?? 0) + 1);
    if (!hits.size) continue;
    const by = buildYear.get(addr_key);
    const best = [...hits.entries()].sort((a, b) => b[1] - a[1]).find(([c]) => {
      const reg = cases.get(c)!.first_reg;
      if (by == null || !reg) return true;
      return Math.abs(by - +reg.slice(0, 4)) <= MAX_YEAR_GAP;
    });
    if (best) assignments.push({ addr_key, case_no: best[0], matched_parcels: best[1] });
  }

  await db.delete(building_community);
  await db.delete(communities);
  const caseRows = [...cases.values()];
  for (let i = 0; i < caseRows.length; i += BATCH)
    await db.insert(communities).values(caseRows.slice(i, i + BATCH));
  for (let i = 0; i < assignments.length; i += BATCH)
    await db.insert(building_community).values(assignments.slice(i, i + BATCH));

  const named = assignments.filter((a) => buildYear.has(a.addr_key)).length;
  console.log(`[communities] 歸戶完成:${assignments.length} 個門牌對到建案` +
    `(其中 ${named} 個在 buildings 上,佔 ${(named / Math.max(1, buildYear.size) * 100).toFixed(1)}%)`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
