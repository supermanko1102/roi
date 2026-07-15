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

async function download(season: string | null) {
  const label = season ?? "latest";
  const url = season
    ? `https://plvr.land.moi.gov.tw/DownloadSeason?season=${season}&type=zip&fileName=lvr_landcsv.zip`
    : `https://plvr.land.moi.gov.tw/Download?type=zip&fileName=lvr_landcsv.zip`;

  console.log(`[download] ${label} <- ${url}`);
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} (季別可能尚未釋出)`);
  const buf = Buffer.from(await res.arrayBuffer());

  const dir = path.join(OUT, label);
  fs.mkdirSync(dir, { recursive: true });
  const zip = new AdmZip(buf);
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
  if (seasons.length === 0) await download(null);
  else for (const s of seasons) await download(s);
})();
