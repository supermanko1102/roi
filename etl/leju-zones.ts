/**
 * 由樂居生活圈邊界產生 data/zones.geojson(多城市合併;取代 build-zones.ts 的官方 GIS 版)
 *
 * 資料源:data/leju-subareas-{slug}.geojson(樂居 subarea API 抓下的手繪邊界,
 *   api.leju.com.tw 有 Cloudflare 驗證,無法在此直接重抓;更新方式見 memory leju-subarea-api)
 * 檔名 slug 對應城市(見 SOURCES);缺檔的城市跳過(該市前台就沒有生活圈層)。
 * 跨區生活圈在來源檔會按行政區重複出現(同 leju_id、同 geometry)→ 以 leju_id 去重、行政區合併。
 * 名稱清理:去掉「生活圈」字尾與括號註記,與樂居地圖顯示一致。
 * zone_key = `${city}|${name}`:跨市撞名時前端/統計用它當唯一鍵,name 只作顯示。
 * 用法:tsx etl/leju-zones.ts
 */
import fs from "node:fs";
import path from "node:path";

const DATA = path.join(import.meta.dirname, "..", "data");
const OUT = path.join(DATA, "zones.geojson");
const SOURCES: [string, string][] = [
  ["leju-subareas-taoyuan.geojson", "桃園市"],
  ["leju-subareas-taipei.geojson", "臺北市"],
  ["leju-subareas-newtaipei.geojson", "新北市"],
];
const OFFICIAL_SOURCES = ["ntpc-zones.geojson"];

const cleanName = (raw: string) =>
  raw.replace(/[(（].*?[)）]/g, "").replace(/生活圈$/, "").trim();

const features: any[] = [];
for (const [file, city] of SOURCES) {
  const p = path.join(DATA, file);
  if (!fs.existsSync(p)) { console.log(`[leju-zones] 無 ${file},略過 ${city}`); continue; }
  const src = JSON.parse(fs.readFileSync(p, "utf-8"));
  const byId = new Map<number, any>();
  for (const f of src.features) {
    const prev = byId.get(f.properties.leju_id);
    if (prev) { prev.properties.district += `/${f.properties.district}`; continue; }
    byId.set(f.properties.leju_id, {
      type: "Feature",
      properties: {
        name: cleanName(f.properties.name),
        city,
        district: f.properties.district,
        leju_id: f.properties.leju_id,
        leju_name: f.properties.name,
      },
      geometry: f.geometry,
    });
  }
  const cityFeatures = [...byId.values()];

  // 市內去重後仍撞名(理論上不會)→ 冠行政區消歧;跨市撞名交給 zone_key
  const byName = new Map<string, any[]>();
  for (const f of cityFeatures) {
    const k = f.properties.name;
    (byName.get(k) ?? byName.set(k, []).get(k)!).push(f);
  }
  for (const [name, fs_] of byName) {
    if (fs_.length < 2) continue;
    for (const f of fs_) f.properties.name = `${f.properties.district.split("/")[0].replace(/區$/, "")}${name}`;
    console.log(`[leju-zones] ${city} 撞名「${name}」→ ${fs_.map((f: any) => f.properties.name).join("、")}`);
  }
  for (const f of cityFeatures) f.properties.zone_key = `${city}|${f.properties.name}`;
  features.push(...cityFeatures);
  console.log(`[leju-zones] ${city} ${cityFeatures.length} 個生活圈`);
}

// 官方重劃／特定區可與市場生活圈並存；同 city|name 時以官方 GIS 邊界取代。
for (const file of OFFICIAL_SOURCES) {
  const p = path.join(DATA, file);
  if (!fs.existsSync(p)) { console.log(`[leju-zones] 無 ${file},略過官方區界`); continue; }
  const official = JSON.parse(fs.readFileSync(p, "utf-8"));
  for (const f of official.features) {
    const key = f.properties.zone_key ?? `${f.properties.city}|${f.properties.name}`;
    const i = features.findIndex((existing) => existing.properties.zone_key === key);
    if (i >= 0) features.splice(i, 1);
    features.push({ ...f, properties: { ...f.properties, zone_key: key } });
  }
  console.log(`[leju-zones] ${file} ${official.features.length} 個官方區界`);
}

fs.writeFileSync(OUT, JSON.stringify({ type: "FeatureCollection", features }));
console.log(`[leju-zones] 共 ${features.length} 個生活圈 → ${path.relative(process.cwd(), OUT)}`);
