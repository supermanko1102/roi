/**
 * 下載內政部實價登錄整批資料(城市清單見 src/lib/cities)
 * 資料源:https://plvr.land.moi.gov.tw(全國一包 zip,依檔名前綴挑城市)
 * 用法:
 *   tsx etl/download-lvr.ts              # 最新一期
 *   tsx etl/download-lvr.ts 114S4 115S1  # 指定季別(民國年S季)
 * 產出:etl/downloads/{season}/{code}_lvr_land_{a|b|c|a_land}.csv
 */
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { CITIES } from "../src/lib/cities";

const OUT = path.join(import.meta.dirname, "downloads");
// a=中古買賣 b=預售 c=租賃;a_land=買賣交易的坐落地號(社區歸戶用)
const KINDS = ["a", "b", "c", "a_land"];
const wantedFor = (code: string) => KINDS.map((k) => `${code}_lvr_land_${k}.csv`);

/**
 * 每旬(1/11/21)發布上一旬的登錄;季界在 2/11、5/11、8/11、11/11。
 * 最新一旬以「季#旬」入庫(如 115S3#0701)累積不互相覆蓋,
 * 待該季正式打包檔釋出後由 parse 整季取代。
 */
export function batchInfo(now = new Date()) {
  const tw = new Date(now.getTime() + 8 * 3600e3); // GHA runner 是 UTC,以台灣時間為準
  const d = new Date(tw.getTime() - 11 * 86400e3); // 回推到本批涵蓋的旬內
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
  const q = m * 100 + day;
  const season =
    q >= 1111 ? `${y - 1910}S1` :
    q >= 811 ? `${y - 1911}S4` :
    q >= 511 ? `${y - 1911}S3` :
    q >= 211 ? `${y - 1911}S2` : `${y - 1911}S1`;
  const decade = day <= 10 ? 1 : day <= 20 ? 11 : 21;
  const label = `${season}#${String(m).padStart(2, "0")}${String(decade).padStart(2, "0")}`;
  return { season, label };
}

export function prevSeason(season: string) {
  const y = +season.slice(0, 3), s = +season.slice(4);
  return s === 1 ? `${y - 1}S4` : `${y}S${s - 1}`;
}

async function download(season: string | null, label = season ?? "latest") {
  const url = season
    ? `https://plvr.land.moi.gov.tw/DownloadSeason?season=${season}&type=zip&fileName=lvr_landcsv.zip`
    : `https://plvr.land.moi.gov.tw/Download?type=zip&fileName=lvr_landcsv.zip`;

  console.log(`[download] ${label} <- ${url}`);
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} (季別可能尚未釋出)`);
  const buf = Buffer.from(await res.arrayBuffer());

  let zip: AdmZip;
  try {
    zip = new AdmZip(buf);
  } catch {
    throw new Error("回應不是有效 zip(季別可能尚未釋出)");
  }
  const dir = path.join(OUT, label);
  fs.mkdirSync(dir, { recursive: true });
  const hits = new Map(CITIES.map((c) => [c.code, 0]));
  const wanted = new Map(CITIES.flatMap((c) => wantedFor(c.code).map((f) => [f, c.code] as const)));
  for (const entry of zip.getEntries()) {
    const name = entry.entryName.toLowerCase();
    const code = wanted.get(name);
    if (code != null) {
      fs.writeFileSync(path.join(dir, name), entry.getData());
      console.log(`  saved ${name} (${(entry.header.size / 1024).toFixed(0)} KB)`);
      hits.set(code, (hits.get(code) ?? 0) + 1);
    }
  }
  // 缺檔不能靜默:某城市整組沒抓到通常是代碼寫錯或該期未含該市
  for (const c of CITIES) {
    if (!hits.get(c.code)) {
      console.warn(`  [warn] ${label} 找不到${c.name}(${c.code}_*)檔案,zip 內容:`,
        zip.getEntries().map((e) => e.entryName).slice(0, 20));
    }
  }
}

const seasons = process.argv.slice(2);
(async () => {
  if (seasons.length > 0) {
    for (const s of seasons) await download(s);
    return;
  }
  const { season, label } = batchInfo();
  await download(null, label); // 最新一旬,以「季#旬」累積入庫
  const prev = prevSeason(season);
  try {
    await download(prev); // 順帶重抓上一個完整季度,自動回補被旬檔覆蓋不到的區間
  } catch (e) {
    console.warn(`[download] ${prev} 跳過:${e instanceof Error ? e.message : e}`);
  }
})();
