/**
 * 下載內政部實價登錄整批資料(桃園)
 * 資料源:https://plvr.land.moi.gov.tw
 * 用法:
 *   tsx etl/download-lvr.ts              # 最新一期
 *   tsx etl/download-lvr.ts 114S4 115S1  # 指定季別(民國年S季)
 * 產出:etl/downloads/{season}/h_lvr_land_b.csv(桃園預售)、h_lvr_land_c.csv(桃園租賃)
 */
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";

const OUT = path.join(import.meta.dirname, "downloads");
// h = 桃園市;要擴市就加代碼(a台北 f新北 b台中 e高雄...)
// a=中古買賣 b=預售 c=租賃;a_land=買賣交易的坐落地號(社區歸戶用)
const WANTED = ["h_lvr_land_a.csv", "h_lvr_land_b.csv", "h_lvr_land_c.csv", "h_lvr_land_a_land.csv"];

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
  let hit = 0;
  for (const entry of zip.getEntries()) {
    if (WANTED.includes(entry.entryName.toLowerCase())) {
      fs.writeFileSync(path.join(dir, entry.entryName.toLowerCase()), entry.getData());
      console.log(`  saved ${entry.entryName} (${(entry.header.size / 1024).toFixed(0)} KB)`);
      hit++;
    }
  }
  if (!hit) console.warn("  找不到桃園檔案,zip 內容:", zip.getEntries().map(e => e.entryName).slice(0, 20));
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
