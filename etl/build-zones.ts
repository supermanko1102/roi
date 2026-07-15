/**
 * 由官方 GIS 圖資產生生活圈邊界 data/taoyuan-zones.geojson
 *
 * 資料源:桃園市都市計畫地理資訊服務(ArcGIS REST,urbandatasrv.tycg.gov.tw)
 *   layer 22 都市計畫區範圍:法定計畫區邊界(青埔=高鐵桃園車站特定區 等)
 *   layer 0  段界圖:地籍段 polygon(重劃區完成後新設段 → union 即重劃區邊界)
 *
 * 定義在 data/zone-defs.json:official 取計畫區、sections 取段界 dissolve。
 * 圖資快取在 etl/downloads/gis/(--refresh 強制重抓)。
 * 用法:tsx etl/build-zones.ts [--refresh]
 */
import fs from "node:fs";
import path from "node:path";
// @ts-expect-error mapshaper 沒有型別定義
import mapshaper from "mapshaper";

const GIS = "https://urbandatasrv.tycg.gov.tw/server/rest/services/TY_UPGIS/TYMap_SDE/MapServer";
const CACHE = path.join(import.meta.dirname, "downloads", "gis");
const DEFS = path.join(import.meta.dirname, "..", "data", "zone-defs.json");
const OUT = path.join(import.meta.dirname, "..", "data", "taoyuan-zones.geojson");

async function fetchGis(file: string, url: string, refresh: boolean): Promise<any> {
  const p = path.join(CACHE, file);
  if (!refresh && fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf-8"));
  console.log(`[zones] 下載 ${file}`);
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const j = await res.json();
  if (j.error) throw new Error(`GIS error: ${JSON.stringify(j.error)}`);
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(j));
  return j;
}

async function main() {
  const refresh = process.argv.includes("--refresh");
  const defs = JSON.parse(fs.readFileSync(DEFS, "utf-8"));

  // 法定計畫區
  const plans = await fetchGis("plans.geojson",
    `${GIS}/22/query?where=1%3D1&outFields=MUPLAN,Label&outSR=4326&f=geojson`, refresh);
  const officialFeatures = defs.official.map((z: any) => {
    const f = plans.features.find((p: any) => p.properties.Label === z.label);
    if (!f) throw new Error(`計畫區找不到 Label=${z.label}`);
    return { type: "Feature", properties: { name: z.name, district: z.district, source: "都市計畫區範圍" }, geometry: f.geometry };
  });

  // 地籍段 → 標上生活圈名,交給 mapshaper dissolve 成乾淨外框
  const districts: string[] = [...new Set(defs.sections.map((z: any) => z.district))] as string[];
  const sectByDistrict: Record<string, any[]> = {};
  for (const d of districts) {
    const j = await fetchGis(`sect_${d}.geojson`,
      `${GIS}/0/query?where=${encodeURIComponent(`TNAME='${d}'`)}&outFields=TNAME,SECNAME&outSR=4326&f=geojson`, refresh);
    if (j.exceededTransferLimit) throw new Error(`${d} 段界超過單次上限,需分頁`);
    sectByDistrict[d] = j.features;
  }
  const tagged: any[] = [];
  for (const z of defs.sections) {
    for (const name of z.sections) {
      const hits = sectByDistrict[z.district].filter((f: any) => f.properties.SECNAME === name);
      if (!hits.length) { console.warn(`  [warn] ${z.district} 查無段名「${name}」(${z.name})`); continue; }
      for (const f of hits)
        tagged.push({ type: "Feature", properties: { name: z.name, district: z.district }, geometry: f.geometry });
    }
  }
  const dissolved = await mapshaper.applyCommands(
    "-i in.geojson -dissolve2 fields=name copy-fields=district -o out.geojson",
    { "in.geojson": JSON.stringify({ type: "FeatureCollection", features: tagged }) });
  const sectionFeatures = JSON.parse(dissolved["out.geojson"].toString()).features
    .map((f: any) => ({ ...f, properties: { ...f.properties, source: "地籍段界" } }));

  const fc = {
    type: "FeatureCollection",
    _comment: "由 etl/build-zones.ts 產生,勿手改;調整範圍請改 data/zone-defs.json 後重跑 pnpm etl:zones",
    features: [...sectionFeatures, ...officialFeatures],
  };
  fs.writeFileSync(OUT, JSON.stringify(fc));
  console.log(`[zones] 完成:${sectionFeatures.length} 個段界生活圈 + ${officialFeatures.length} 個法定計畫區 → ${path.relative(process.cwd(), OUT)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
