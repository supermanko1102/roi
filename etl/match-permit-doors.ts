/**
 * 使照門牌歸戶(桃園建管開放資料)——備查地號交集之外的第四條歸戶通路。
 *
 * 背景:近半數備查列「編號」空白,只剩單一代表地號,大基地案地號交集恆零
 * (2021+ 完工門牌有 1.5 萬+ 個零交集)。但備查案 99.5% 有建照號碼,而
 * 桃園建管開放資料(BUILDLIC)可按「原領執照字號」查到使用執照,
 * 使照帶「逐戶門牌清單」——門牌直接歸戶,不需地號、不需 geocode。
 *
 * 流程(逐備查案):
 *   1. communities.permit_no → 抽「字第」後尾碼當查詢鍵(如 會龍01641),
 *      GET building.tycg.gov.tw/opendata/OpenDataSearchUrl.do?c=BUILDLIC&原領執照字號=.*尾碼.*
 *   2. 候選使照與備查建照比對 permitMatchKey(年度+尾碼,去前導零/括號/變更設計尾碼)
 *   3. 使照門牌 → normAddrKey → building_community upsert
 *      (match_method='permit-door', confidence 98;不覆蓋地號/樂居/老案歸戶)
 *   4. 使照(license_no/permit_no_norm/issue_date)upsert 進 use_permits
 *      (桃園無整批使照資料源,import-use-permits 不會清掉這些列),
 *      並直接回填 communities.use_issue_date(與 match-communities 每晚重算收斂一致)
 *
 * 快取:etl/downloads/permit-doors/;查無使照也快取(30 天後重試,新完工案會補上)。
 * 冪等可重跑;building_community 每晚被 match-communities 重建後由本步驟重灌。
 * 用法:tsx etl/match-permit-doors.ts [--limit N] [--refresh]
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { and, eq, isNotNull, notLike, sql } from "drizzle-orm";
import { createDb, building_community, communities, use_permits } from "../db/client";
import { cityByName } from "../src/lib/cities";
import { normAddrKey, normPermitNo } from "./addr";

const CACHE_DIR = path.join(import.meta.dirname, "downloads", "permit-doors");
const API = "https://building.tycg.gov.tw/opendata/OpenDataSearchUrl.do";
const THROTTLE_MS = 400;
const NEGATIVE_RETRY_DAYS = 30;
const BATCH = 200;

const toHalf = (s: string) =>
  s.replace(/[０-９Ａ-Ｚａ-ｚ（）]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
const toFullDigits = (s: string) =>
  s.replace(/[0-9]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));

/** 「113年04月10日」→ 2024-04-10(民國曆;格式或曆法異常──如 6月31日──回 null) */
export function cnRocDate(raw: string | null | undefined): string | null {
  const m = raw?.trim().match(/^(\d{2,3})年(\d{1,2})月(\d{1,2})日$/);
  if (!m) return null;
  const y = +m[1] + 1911;
  // V8 對「2003-02-29」這種無效日期會自動進位而非回 NaN,必須逐欄回驗
  const dt = new Date(Date.UTC(y, +m[2] - 1, +m[3]));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() + 1 !== +m[2] || dt.getUTCDate() !== +m[3]) return null;
  return `${y}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

/**
 * 建照號碼拆解:年度(可缺)、區碼前綴(會龍/會觀…,可缺)、序號。
 * 備查登打很髒:「字第」可能漏寫成「字」「第」或整段消失(「108桃市都建執照01465-1號」),
 * 年度也可能缺(「桃市都建執照字會觀01532-01號」)。一律以「尾端序號」定錨往前解析。
 */
export type PermitParts = { year: number | null; prefix: string; serial: string; serialRaw: string };
export function parsePermit(raw: string | null | undefined): PermitParts | null {
  if (!raw) return null;
  const s = toHalf(raw).replace(/[\s()]/g, "");
  const m = s.match(/(\d{3,5})(?:[-之]\d+)?號?$/); // 變更設計尾碼不進鍵
  if (!m || m.index == null) return null;
  // 區碼(會龍/會觀…)=序號前緊鄰的非公文字;「字/第/照/執」是公文接尾詞,碰到即止
  const prefix = s.slice(0, m.index).match(/([^\d字第照執]{1,2})$/)?.[1] ?? "";
  const year = s.match(/^(\d{2,3})[^\d]/)?.[1];
  return {
    year: year ? +year : null, prefix,
    serial: String(+m[1]), serialRaw: m[1],
  };
}

/** 模糊查詢鍵:有區碼用「區碼+原序號」,沒有就只用序號(靠 permitsMatch 過濾誤中) */
export function permitQueryTail(permitNo: string): string | null {
  const p = parsePermit(permitNo);
  if (!p) return null;
  return p.prefix ? `${p.prefix}${p.serialRaw}` : p.serialRaw.length >= 4 ? p.serialRaw : null;
}

/**
 * 兩張執照是否同一張:序號必等;年度兩邊都有才比;區碼兩邊都有才比。
 * 回傳 "exact"(全部命中)或 "lenient"(有缺項,呼叫端須再驗行政區)或 null。
 */
export function permitsMatch(ours: PermitParts | null, theirs: PermitParts | null): "exact" | "lenient" | null {
  if (!ours || !theirs || ours.serial !== theirs.serial) return null;
  if (ours.year != null && theirs.year != null && ours.year !== theirs.year) return null;
  if (ours.prefix && theirs.prefix && ours.prefix !== theirs.prefix) return null;
  const complete = ours.year != null && theirs.year != null && !!ours.prefix && !!theirs.prefix;
  return complete ? "exact" : "lenient";
}

/** 比對鍵(舊介面,測試用):年度|區碼+序號 */
export function permitMatchKey(permitNo: string | null | undefined): string | null {
  const p = parsePermit(permitNo);
  return p && p.year != null ? `${p.year}|${p.prefix}${p.serial}` : null;
}

type PermitDoor = { 行政區?: string; 路街段巷弄?: string; 號?: string };
type BuildlicRow = {
  執照類別?: string; 核發執照字號?: string; 原領執照字號?: string;
  發照日期?: string; 竣工日期?: string; 戶數?: string;
  門牌?: PermitDoor[]; 地號?: unknown[];
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function queryUsePermits(tail: string): Promise<BuildlicRow[]> {
  const url = `${API}?d=OPENDATA&c=BUILDLIC&Start=1&` +
    `${encodeURIComponent("原領執照字號")}=${encodeURIComponent(`.*${tail}.*`)}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json() as { data?: BuildlicRow[] };
  return (body.data ?? []).filter((r) => r["執照類別"] === "使用執照");
}

type CacheEntry = { fetched_at: string; rows: BuildlicRow[] };

function readCache(caseNo: string): CacheEntry | null {
  const p = path.join(CACHE_DIR, `${caseNo.replace(/[^\w#-]/g, "_")}.json`);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return null; }
}
function writeCache(caseNo: string, entry: CacheEntry) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(path.join(CACHE_DIR, `${caseNo.replace(/[^\w#-]/g, "_")}.json`), JSON.stringify(entry));
}

async function main() {
  const args = process.argv.slice(2);
  const refresh = args.includes("--refresh");
  const limit = args.includes("--limit") ? +args[args.indexOf("--limit") + 1] : Infinity;
  const city = cityByName("桃園市")!;

  const { db, pool } = createDb();
  // 只跑桃園真實備查案(合成案 leju|/pd| 無建照);全案都跑,upsert 不覆蓋既有歸戶
  const cases = await db.select({
    case_no: communities.case_no, district: communities.district,
    permit_no: communities.permit_no, use_issue_date: communities.use_issue_date,
  }).from(communities)
    .where(and(
      eq(communities.city, "桃園市"), isNotNull(communities.permit_no),
      notLike(communities.case_no, "leju|%"), notLike(communities.case_no, "pd|%"),
    ));

  let fetched = 0, cacheHits = 0, matchedCases = 0, doorRows = 0, permitRows = 0, apiErrors = 0;
  const staleBefore = Date.now() - NEGATIVE_RETRY_DAYS * 86_400_000;

  for (const c of cases.slice(0, Number.isFinite(limit) ? limit : cases.length)) {
    const tail = permitQueryTail(c.permit_no!);
    const ours = parsePermit(c.permit_no);
    if (!tail || !ours) continue;

    let cache = refresh ? null : readCache(c.case_no);
    // 查無使照的快取超過 30 天重試(可能剛完工領照)
    if (cache && !cache.rows.length && Date.parse(cache.fetched_at) < staleBefore) cache = null;
    if (!cache) {
      if (fetched > 0) await sleep(THROTTLE_MS);
      try {
        cache = { fetched_at: new Date().toISOString(), rows: await queryUsePermits(tail) };
        fetched++;
        writeCache(c.case_no, cache);
      } catch {
        apiErrors++;
        if (apiErrors >= 10) { console.warn("[permit-doors] API 連續異常,提前收工(下輪續跑)"); break; }
        await sleep(5000);
        continue;
      }
    } else {
      cacheHits++;
    }

    // 同尾碼可能撞到別年/別區建照:exact 直接收;lenient(登打缺年度或區碼)
    // 需使照自己的門牌或地號落在本案行政區才收,防止同序號跨區誤配
    const inDistrict = (r: BuildlicRow) =>
      (r["門牌"] ?? []).some((d) => (d["行政區"] ?? "").includes(c.district)) ||
      ((r["地號"] ?? []) as { 行政區?: string }[]).some((d) => (d["行政區"] ?? "").includes(c.district));
    const hits = cache.rows.filter((r) => {
      const verdict = permitsMatch(ours, parsePermit(r["原領執照字號"]));
      return verdict === "exact" || (verdict === "lenient" && inDistrict(r));
    });
    if (!hits.length) continue;

    const addrKeys = new Set<string>();
    for (const r of hits) {
      for (const door of r["門牌"] ?? []) {
        const street = (door["路街段巷弄"] ?? "").trim();
        const no = (door["號"] ?? "").trim();
        if (!street || !no || !no.includes("號")) continue;
        // 使照行政區可能寫舊制(桃園縣八德市),一律用備查案的區;
        // 「23-1號」的連字號改成實登慣用的「之」,addr_key 才對得上
        const key = normAddrKey(city, c.district,
          toFullDigits(`${street}${no}`).replace(/(?<=[０-９])[-－](?=[０-９])/g, "之"));
        if (key) addrKeys.add(key);
      }
    }

    // 使照本體 → use_permits(桃園逐案補;import-use-permits 無桃園 adapter 不會清掉)
    for (const r of hits) {
      const license = toHalf(r["核發執照字號"] ?? "").trim();
      if (!license) continue;
      const issue = cnRocDate(r["發照日期"]);
      await db.insert(use_permits).values({
        city: "桃園市", license_no: license,
        permit_no_norm: normPermitNo(r["原領執照字號"]),
        issue_date: issue, complete_date: cnRocDate(r["竣工日期"]),
        address: null, source: "桃園建管 BUILDLIC",
      }).onConflictDoNothing();
      permitRows++;
      // 立即回填屋齡判定用的使照發照日(match-communities 每晚以 use_permits 重算,結果一致)
      if (issue && !c.use_issue_date) {
        await db.update(communities).set({ use_issue_date: issue })
          .where(eq(communities.case_no, c.case_no));
      }
    }

    if (!addrKeys.size) continue;
    matchedCases++;
    const values = [...addrKeys].map((addr_key) => ({
      addr_key, case_no: c.case_no, matched_parcels: 0,
      match_method: "permit-door", confidence: 98,
    }));
    for (let i = 0; i < values.length; i += BATCH) {
      const inserted = await db.insert(building_community)
        .values(values.slice(i, i + BATCH)).onConflictDoNothing()
        .returning({ addr_key: building_community.addr_key });
      doorRows += inserted.length;
    }
  }

  // community_id 補連結:permit-door 新列掛回實體社區(quality gate 只查 case_no,此欄可空,補上供前台聚合)
  await db.execute(sql`
    UPDATE building_community bc SET community_id = cc.community_id
    FROM community_cases cc
    WHERE bc.case_no = cc.case_no AND bc.community_id IS NULL AND bc.match_method = 'permit-door'`);

  console.log(`[permit-doors] 備查案 ${cases.length} 個:API 查詢 ${fetched}(快取 ${cacheHits}、錯誤 ${apiErrors})、` +
    `使照命中 ${matchedCases} 案、門牌歸戶 +${doorRows}、use_permits +${permitRows}`);
  await pool.end();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((e) => { console.error(e); process.exit(1); });
