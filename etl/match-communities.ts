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
 * 鄰棟繼承:地號配完後,未歸戶門牌若 70m 內有完工年 ±1 的已歸戶門牌,
 * 且範圍內候選只有單一社區,則繼承之(match_method='neighbor',confidence 70)
 * ——救回分期漏備查、地號重編的社區成員門牌。
 * 寫入:communities、physical_communities、community_cases、building_community
 * (整批重建,可重複執行)。
 */
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";
import { count, sql } from "drizzle-orm";
import {
  createDb, communities, physical_communities, community_cases, building_community,
} from "../db/client";
import { CITIES } from "../src/lib/cities";
import { normAddrKey, normPermitNo } from "./addr";
import { assertReplacementSafe } from "./replacement-safety";

const DL = path.join(import.meta.dirname, "downloads");
const CASE_DIR = path.join(DL, "buildcase");
const CASE_ZIP_URL = "https://plvr.land.moi.gov.tw/Download?type=zip&PayType=saleremark&fileName=lvr_buildcasecsv.zip";
const caseFilesFor = (code: string) => [`${code}_lvr_buildcase.csv`, `${code}_lvr_buildingland.csv`];
const ALL_CASE_FILES = CITIES.flatMap((c) => caseFilesFor(c.code));
const MAX_YEAR_GAP = 4;
const BATCH = 500;

const entityKey = (c: typeof communities.$inferInsert) => {
  const name = c.name.normalize("NFKC").replace(/[\s‐‑–—－-]/g, "").toLowerCase();
  // 同一實體社區可能分期、分建照備查；使用「城市＋行政區＋標準化建案名」作主實體鍵，
  // 建照留作來源欄位，避免一個社區因不同建照被拆成多個實體。
  return `${c.city}|${c.district}|name:${name}`;
};

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
  if (!refresh && ALL_CASE_FILES.every((f) => fs.existsSync(path.join(CASE_DIR, f)))) return;
  console.log(`[communities] 下載建案備查 <- ${CASE_ZIP_URL}`);
  const res = await fetch(CASE_ZIP_URL, {
    headers: { "User-Agent": "Mozilla/5.0", Referer: "https://plvr.land.moi.gov.tw/DownloadOpenData" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));
  fs.mkdirSync(CASE_DIR, { recursive: true });
  for (const entry of zip.getEntries()) {
    const name = entry.entryName.toLowerCase();
    if (ALL_CASE_FILES.includes(name)) fs.writeFileSync(path.join(CASE_DIR, name), entry.getData());
  }
  // 備查 zip 是否含各市檔案要在這裡驗證(缺檔不能靜默)
  for (const c of CITIES) {
    for (const f of caseFilesFor(c.code)) {
      if (!fs.existsSync(path.join(CASE_DIR, f))) console.warn(`  [warn] 備查 zip 缺 ${f}(${c.name})`);
    }
  }
}

async function main() {
  const refresh = process.argv.includes("--refresh");
  const allowEmpty = process.argv.includes("--allow-empty");
  await ensureCaseFiles(refresh);
  const { db, pool } = createDb();

  // ---- 使照:建照號碼(正規化)→ 最早發照日(先跑 etl:use-permits;無資料的城市 map 為空) ----
  const permitIssue = new Map<string, string>();
  {
    const { rows } = await db.execute(sql`
      SELECT city, permit_no_norm, min(issue_date) AS issue_date FROM use_permits
      WHERE permit_no_norm IS NOT NULL AND issue_date IS NOT NULL
      GROUP BY city, permit_no_norm`);
    for (const r of rows as { city: string; permit_no_norm: string; issue_date: string }[])
      permitIssue.set(`${r.city}|${r.permit_no_norm}`, String(r.issue_date).slice(0, 10));
    if (permitIssue.size) console.log(`[communities] 使照 ${permitIssue.size} 個建照號碼可供屋齡判定`);
  }

  // ---- 建案側:case → 基本資料 + 地號集合(逐城市) ----
  type CaseInfo = typeof communities.$inferInsert;
  const cases = new Map<string, CaseInfo>();
  const parcelToCases = new Map<string, string[]>();
  for (const city of CITIES) {
    const caseFile = path.join(CASE_DIR, `${city.code}_lvr_buildcase.csv`);
    const landCaseFile = path.join(CASE_DIR, `${city.code}_lvr_buildingland.csv`);
    if (!fs.existsSync(caseFile) || !fs.existsSync(landCaseFile)) continue;
    {
      const [h, ...rows] = readCsv(caseFile);
      const iDist = col(h, "鄉鎮市區"), iName = col(h, "建案名稱"), iStreet = col(h, "坐落街道");
      const iHh = col(h, "層棟戶數"), iPermit = col(h, "建造執照"), iReg = col(h, "第1次登記");
      const iDecl = col(h, "申報備查"), iNo = col(h, "編號"), iBase = col(h, "坐落基地");
      for (const r of rows) {
        if (!r[iName]) continue;
        // 近半數備查列的「編號」空白(如 遠雄夏沐、合雄大境),不能因此丟棄:
        // 合成穩定 key 補進 cases,地號改用主檔「坐落基地」欄(單一代表地號)。
        const rawNo = r[iNo]?.trim();
        const case_no = rawNo || `${city.code.toUpperCase()}#${r[iDist]}#${r[iName].trim()}#${(r[iDecl] ?? "").trim()}`;
        const hhm = (r[iHh] ?? "").match(/(\d+)戶/) ?? (r[iHh] ?? "").match(/^(\d+)$/);
        const permitNo = r[iPermit] || null;
        const permitNorm = normPermitNo(permitNo);
        cases.set(case_no, {
          case_no, name: r[iName].trim(), city: city.name, district: r[iDist],
          households: hhm ? +hhm[1] : null,
          street: r[iStreet] || null, permit_no: permitNo,
          first_reg: rocDate(r[iReg]), declare_date: rocDate(r[iDecl]),
          use_issue_date: permitNorm ? permitIssue.get(`${city.name}|${permitNorm}`) ?? null : null,
        });
        if (!rawNo) {
          const p = parseParcelText(r[iBase] ?? "");
          if (p) {
            const key = `${city.name}|${r[iDist]}|${p.sec}|${p.no}`;
            (parcelToCases.get(key) ?? parcelToCases.set(key, []).get(key)!).push(case_no);
          }
        }
      }
    }
    {
      const [h, ...rows] = readCsv(landCaseFile);
      const iNo = col(h, "編號"), iLand = col(h, "土地位置");
      for (const r of rows) {
        const c = cases.get(r[iNo]?.trim());
        const p = parseParcelText(r[iLand] ?? "");
        if (!c || !p) continue;
        const key = `${c.city}|${c.district}|${p.sec}|${p.no}`;
        (parcelToCases.get(key) ?? parcelToCases.set(key, []).get(key)!).push(c.case_no);
      }
    }
  }

  // ---- 交易側:addr_key → 地號集合(掃所有期別 × 城市) ----
  const addrParcels = new Map<string, Set<string>>();
  let seasonsUsed = 0;
  for (const season of fs.readdirSync(DL)) {
    if (season === "buildcase") continue;
    let seasonHasData = false;
    for (const city of CITIES) {
      const aFile = path.join(DL, season, `${city.code}_lvr_land_a.csv`);
      const landFile = path.join(DL, season, `${city.code}_lvr_land_a_land.csv`);
      if (!fs.existsSync(aFile) || !fs.existsSync(landFile)) {
        if (fs.existsSync(aFile)) console.warn(`  [warn] ${season} 缺 ${city.code}_…a_land.csv,先 pnpm etl:download ${season} 補齊`);
        continue;
      }
      seasonHasData = true;
      const serials = new Map<string, { addr_key: string; district: string }>();
      {
        const [h, ...rows] = readCsv(aFile);
        const iDist = col(h, "鄉鎮市區"), iAddr = col(h, "土地位置"), iNo = col(h, "編號");
        for (const r of rows) {
          const addr = r[iAddr] ?? "";
          // 純土地交易的位置是「○○段690地號」,不是門牌,跳過
          if (!addr.includes("號") || /地號/.test(addr) || !r[iNo]) continue;
          const addrKey = normAddrKey(city, r[iDist], addr);
          if (addrKey) serials.set(r[iNo], { addr_key: addrKey, district: r[iDist] });
        }
      }
      const [h, ...rows] = readCsv(landFile);
      const iNo = col(h, "編號"), iSec = col(h, "土地位置"), iCode = col(h, "地號");
      for (const r of rows) {
        const s = serials.get(r[iNo]);
        const sec = (r[iSec] ?? "").trim();
        const no = parseParcelCode(r[iCode] ?? "");
        if (!s || !sec.endsWith("段") || !no) continue;
        const key = `${city.name}|${s.district}|${sec}|${no}`;
        (addrParcels.get(s.addr_key) ?? addrParcels.set(s.addr_key, new Set()).get(s.addr_key)!).add(key);
      }
    }
    if (seasonHasData) seasonsUsed++;
  }
  console.log(`[communities] 建案 ${cases.size} 個(${parcelToCases.size} 筆地號)、` +
    `門牌 ${addrParcels.size} 個(掃 ${seasonsUsed} 期)`);

  // ---- 歸戶:地號交集數最多者勝,屋齡與完工年差過大者剔除 ----
  const { rows: byRows } = await db.execute(sql`SELECT addr_key, build_year, lat, lng FROM buildings`);
  type BuildingRow = { addr_key: string; build_year: number | null; lat: number | null; lng: number | null };
  const buildingData = new Map((byRows as BuildingRow[]).map((r) => [r.addr_key, r]));
  const buildYear = new Map((byRows as BuildingRow[]).map((r) => [r.addr_key, r.build_year]));

  const assignments: (typeof building_community.$inferInsert)[] = [];
  // 診斷聚焦備查時代(2021+ 完工)門牌:老屋零交集是制度性的,不值得看
  const diag = { hit: 0, zero: 0, gap: 0 };
  const zeroDistricts = new Map<string, number>();
  const districtOf = (addrKey: string) =>
    addrKey.replace(/^.{2,3}[市縣]/, "").match(/^(.+?[區鎮鄉市])/)?.[1] ?? "?";
  for (const [addr_key, parcels] of addrParcels) {
    const hits = new Map<string, number>();
    for (const p of parcels)
      for (const c of parcelToCases.get(p) ?? []) hits.set(c, (hits.get(c) ?? 0) + 1);
    const by = buildYear.get(addr_key);
    const modern = by != null && by >= 2021;
    if (!hits.size) {
      if (modern) {
        diag.zero++;
        const d = districtOf(addr_key);
        zeroDistricts.set(d, (zeroDistricts.get(d) ?? 0) + 1);
      }
      continue;
    }
    const best = [...hits.entries()].sort((a, b) => b[1] - a[1]).find(([c]) => {
      const reg = cases.get(c)!.first_reg;
      if (by == null || !reg) return true;
      return Math.abs(by - +reg.slice(0, 4)) <= MAX_YEAR_GAP;
    });
    if (best) {
      assignments.push({ addr_key, case_no: best[0], matched_parcels: best[1] });
      if (modern) diag.hit++;
    } else if (modern) diag.gap++;
  }
  console.log(`[communities] 診斷(2021+ 完工門牌):命中 ${diag.hit}、有地號但零交集 ${diag.zero}、` +
    `年差 >${MAX_YEAR_GAP} 剔除 ${diag.gap}`);
  if (zeroDistricts.size) console.log(`  零交集前幾區:` + [...zeroDistricts.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 8).map(([d, n]) => `${d} ${n}`).join("、"));

  // ---- 鄰棟繼承:未歸戶門牌 70m 內有完工年 ±1 的已歸戶門牌,且唯一社區,則繼承 ----
  const NEIGHBOR_M = 70, NEIGHBOR_YEAR = 1, CELL = 0.0007; // ≈78m 網格,掃 3×3 覆蓋 70m 半徑
  const metersApprox = (lat1: number, lng1: number, lat2: number, lng2: number) => {
    const dy = (lat1 - lat2) * 111_320;
    const dx = (lng1 - lng2) * 111_320 * Math.cos((lat1 * Math.PI) / 180);
    return Math.hypot(dx, dy);
  };
  const cellOf = (lat: number, lng: number) => `${Math.round(lat / CELL)}|${Math.round(lng / CELL)}`;
  type Anchor = { lat: number; lng: number; by: number; case_no: string; ek: string };
  const grid = new Map<string, Anchor[]>();
  const assignedKeys = new Set(assignments.map((a) => a.addr_key));
  for (const a of assignments) {
    const b = buildingData.get(a.addr_key);
    if (b?.lat == null || b.lng == null || b.build_year == null) continue;
    const anchor: Anchor = {
      lat: +b.lat, lng: +b.lng, by: +b.build_year,
      case_no: a.case_no, ek: entityKey(cases.get(a.case_no)!),
    };
    const key = cellOf(anchor.lat, anchor.lng);
    (grid.get(key) ?? grid.set(key, []).get(key)!).push(anchor);
  }
  let nbAssigned = 0, nbAmbiguous = 0;
  for (const b of byRows as BuildingRow[]) {
    if (assignedKeys.has(b.addr_key) || b.lat == null || b.lng == null || b.build_year == null) continue;
    const lat = +b.lat, lng = +b.lng, by = +b.build_year;
    const cands: Anchor[] = [];
    const cx = Math.round(lat / CELL), cy = Math.round(lng / CELL);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const a of grid.get(`${cx + dx}|${cy + dy}`) ?? []) {
          if (Math.abs(a.by - by) <= NEIGHBOR_YEAR && metersApprox(lat, lng, a.lat, a.lng) <= NEIGHBOR_M)
            cands.push(a);
        }
    if (!cands.length) continue;
    if (new Set(cands.map((a) => a.ek)).size > 1) { nbAmbiguous++; continue; } // 兩社區交界,不硬猜
    const nearest = cands.sort((x, y) =>
      metersApprox(lat, lng, x.lat, x.lng) - metersApprox(lat, lng, y.lat, y.lng))[0];
    assignments.push({
      addr_key: b.addr_key, case_no: nearest.case_no, matched_parcels: 0,
      match_method: "neighbor", confidence: 70,
    });
    nbAssigned++;
  }
  console.log(`[communities] 鄰棟繼承:+${nbAssigned} 個門牌(交界不明跳過 ${nbAmbiguous})`);

  // ---- 實體社區:同市同區標準化建案名歸併，容納分期與不同建照 ----
  const entityDefs = new Map<string, {
    name: string; city: string; district: string; permit_no: string | null; caseNos: string[];
    years: number[]; permitYears: number[]; lats: number[]; lngs: number[];
  }>();
  for (const c of cases.values()) {
    const key = entityKey(c);
    const e = entityDefs.get(key) ?? {
      name: c.name, city: c.city, district: c.district, permit_no: c.permit_no ?? null,
      caseNos: [], years: [], permitYears: [], lats: [], lngs: [],
    };
    e.caseNos.push(c.case_no);
    const y = c.first_reg ? +c.first_reg.slice(0, 4) : null;
    if (y) e.years.push(y);
    // 使照發照年:比首次登記更接近實際完工,有就優先
    const py = c.use_issue_date ? +String(c.use_issue_date).slice(0, 4) : null;
    if (py) e.permitYears.push(py);
    entityDefs.set(key, e);
  }
  for (const a of assignments) {
    const c = cases.get(a.case_no)!;
    const b = buildingData.get(a.addr_key);
    const e = entityDefs.get(entityKey(c))!;
    if (b?.build_year) e.years.push(+b.build_year);
    if (b?.lat != null && b.lng != null) { e.lats.push(+b.lat); e.lngs.push(+b.lng); }
  }

  const caseRows = [...cases.values()];
  const [{ n: previousCases }] = await db.select({ n: count() }).from(communities);
  assertReplacementSafe("[communities] 備查案", previousCases, caseRows.length, allowEmpty);
  const entityId = new Map<string, number>();
  await db.transaction(async (tx) => {
    await tx.delete(building_community);
    await tx.delete(community_cases);
    await tx.delete(physical_communities);
    await tx.delete(communities);
    for (let i = 0; i < caseRows.length; i += BATCH)
      await tx.insert(communities).values(caseRows.slice(i, i + BATCH));

    for (const [key, e] of entityDefs) {
      const [row] = await tx.insert(physical_communities).values({
        name: e.name, city: e.city, district: e.district, permit_no: e.permit_no,
        build_year: e.permitYears.length ? Math.max(...e.permitYears)
          : e.years.length ? Math.max(...e.years) : null,
        lat: e.lats.length ? e.lats.reduce((a, b) => a + b, 0) / e.lats.length : null,
        lng: e.lngs.length ? e.lngs.reduce((a, b) => a + b, 0) / e.lngs.length : null,
      }).returning({ id: physical_communities.id });
      entityId.set(key, row.id);
    }
    const caseLinks = [...cases.values()].map((c) => ({
      case_no: c.case_no, community_id: entityId.get(entityKey(c))!,
    }));
    for (let i = 0; i < caseLinks.length; i += BATCH)
      await tx.insert(community_cases).values(caseLinks.slice(i, i + BATCH));

    const linkedAssignments = assignments.map((a) => ({
      ...a,
      community_id: entityId.get(entityKey(cases.get(a.case_no)!)),
      match_method: a.match_method ?? "parcel",
      confidence: a.confidence ?? Math.min(100, 90 + Math.min(10, (a.matched_parcels ?? 0) * 2)),
    }));
    for (let i = 0; i < linkedAssignments.length; i += BATCH)
      await tx.insert(building_community).values(linkedAssignments.slice(i, i + BATCH));
  });

  const named = assignments.filter((a) => buildYear.has(a.addr_key)).length;
  console.log(`[communities] ${entityDefs.size} 個實體社區；歸戶完成:${assignments.length} 個門牌對到建案` +
    `(其中 ${named} 個在 buildings 上,佔 ${(named / Math.max(1, buildYear.size) * 100).toFixed(1)}%)`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
