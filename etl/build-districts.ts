/**
 * 產出 data/districts.geojson:啟用城市的行政區邊界(features 帶 {city, name})。
 * 資料源:taiwan-atlas(內政部 2020 鄉鎮市區界,npm CDN 的 TopoJSON,已適度簡化)。
 * COUNTYNAME 用「台北市」寫法 → 以 cities.ts 的 alias 正規化成「臺北市」。
 * 一次性 script;新增城市後重跑:tsx etl/build-districts.ts
 */
import fs from "node:fs";
import path from "node:path";
// @ts-expect-error mapshaper 沒有型別定義
import mapshaper from "mapshaper";

const SRC = "https://cdn.jsdelivr.net/npm/taiwan-atlas@2021.9.20/towns-10t.json";
const OUT = path.join(import.meta.dirname, "..", "data", "districts.geojson");

// 檔案預先涵蓋可能上線的城市;實際啟用由 API 端依 CITIES 過濾(上線開關)。
// key=taiwan-atlas 的 COUNTYNAME 寫法(台),value=本專案正規名(臺)。
const TARGETS = new Map([
  ["桃園市", "桃園市"], ["台北市", "臺北市"], ["臺北市", "臺北市"], ["新北市", "新北市"],
]);

async function main() {
  console.log(`[districts] 下載 ${SRC}`);
  const res = await fetch(SRC);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const topo = await res.text();

  const converted = await mapshaper.applyCommands(
    "-i input.json -o format=geojson target=towns precision=0.00001 out.geojson",
    { "input.json": topo },
  );
  const fc = JSON.parse(converted["out.geojson"].toString());

  const features = [];
  for (const f of fc.features) {
    const city = TARGETS.get(f.properties.COUNTYNAME);
    if (!city) continue;
    features.push({
      type: "Feature",
      properties: { city, name: f.properties.TOWNNAME },
      geometry: f.geometry,
    });
  }
  const byCity = new Map<string, number>();
  for (const f of features) byCity.set(f.properties.city, (byCity.get(f.properties.city) ?? 0) + 1);
  for (const name of new Set(TARGETS.values())) {
    if (!byCity.get(name)) console.warn(`  [warn] ${name} 找不到任何行政區`);
  }

  fs.writeFileSync(OUT, JSON.stringify({ type: "FeatureCollection", features }));
  console.log(`[districts] ${features.length} 區 → ${OUT}`,
    Object.fromEntries(byCity));
}
main().catch((e) => { console.error(e); process.exit(1); });
