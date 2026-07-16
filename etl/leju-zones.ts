/**
 * 由樂居生活圈邊界產生 data/taoyuan-zones.geojson(取代 build-zones.ts 的官方 GIS 版)
 *
 * 資料源:data/leju-subareas-taoyuan.geojson(樂居 subarea API 抓下的手繪邊界,
 *   api.leju.com.tw 有 Cloudflare 驗證,無法在此直接重抓;更新方式見 memory leju-subarea-api)
 * 跨區生活圈在來源檔會按行政區重複出現(同 leju_id、同 geometry)→ 以 leju_id 去重、行政區合併。
 * 名稱清理:去掉「生活圈」字尾與括號註記,與樂居地圖顯示一致。
 * 用法:tsx etl/leju-zones.ts
 */
import fs from "node:fs";
import path from "node:path";

const SRC = path.join(import.meta.dirname, "..", "data", "leju-subareas-taoyuan.geojson");
const OUT = path.join(import.meta.dirname, "..", "data", "taoyuan-zones.geojson");

const cleanName = (raw: string) =>
  raw.replace(/[(（].*?[)）]/g, "").replace(/生活圈$/, "").trim();

const src = JSON.parse(fs.readFileSync(SRC, "utf-8"));
const byId = new Map<number, any>();
for (const f of src.features) {
  const prev = byId.get(f.properties.leju_id);
  if (prev) { prev.properties.district += `/${f.properties.district}`; continue; }
  byId.set(f.properties.leju_id, {
    type: "Feature",
    properties: {
      name: cleanName(f.properties.name),
      district: f.properties.district,
      leju_id: f.properties.leju_id,
      leju_name: f.properties.name,
    },
    geometry: f.geometry,
  });
}
const features = [...byId.values()];

// 去重後仍撞名(理論上不會)→ 冠行政區消歧
const byName = new Map<string, any[]>();
for (const f of features) {
  const k = f.properties.name;
  (byName.get(k) ?? byName.set(k, []).get(k)!).push(f);
}
for (const [name, fs_] of byName) {
  if (fs_.length < 2) continue;
  for (const f of fs_) f.properties.name = `${f.properties.district.split("/")[0].replace(/區$/, "")}${name}`;
  console.log(`[leju-zones] 撞名「${name}」→ ${fs_.map((f: any) => f.properties.name).join("、")}`);
}

fs.writeFileSync(OUT, JSON.stringify({ type: "FeatureCollection", features }));
console.log(`[leju-zones] ${features.length} 個生活圈 → ${path.relative(process.cwd(), OUT)}`);
