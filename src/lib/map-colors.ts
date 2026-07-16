import { AGE_BANDS, type BandFilter } from "@/lib/age";

// 地圖色彩系統:單價漸層(abs)與「和行情相比」發散色階(rel)共用一套定義,
// MapLibre expression 與 JS 端(標籤晶片、popup)都從這裡取色,口徑才不會漂移。

export type ColorMode = "rel" | "abs";

export const PRICE_STOPS: [number, string][] = [[20, "#e2ebf5"], [32, "#7aa7cf"], [44, "#184a7c"]];
// 紅=比行情貴、綠=便宜(沿用台灣紅漲綠跌慣例)
export const DEV_STOPS: [number, string][] = [[-15, "#1a7f5c"], [0, "#ece7dd"], [15, "#c2452d"]];

// 車站路線色:機捷紫、台鐵藍、綠線綠(施工中畫空心)
export const LINE_COLOR: Record<string, string> = {
  "機場捷運": "#8e24aa", "台鐵": "#1a5fb4", "桃園捷運綠線": "#2e7d32",
};

export const priceProp = (band: BandFilter) => `price_${band}`;
export const devProp = (band: BandFilter) => `dev_${band}`;

// 區/圈色塊:rel=偏離全市同帶中位 %;abs=所選帶中位單價;無資料灰
export function fillExpr(band: BandFilter, mode: ColorMode): any {
  const prop = mode === "rel" ? devProp(band) : priceProp(band);
  const stops = mode === "rel" ? DEV_STOPS : PRICE_STOPS;
  return [
    "case",
    ["==", ["get", prop], null], "#cfd6da",
    ["interpolate", ["linear"], ["get", prop], ...stops.flat()],
  ];
}
export const PRICE_INTERP: any = ["interpolate", ["linear"], ["get", "price"], ...PRICE_STOPS.flat()];
export const DEV_INTERP: any = ["interpolate", ["linear"], ["get", "dev"], ...DEV_STOPS.flat()];

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function mix(a: [number, string], b: [number, string], v: number): string {
  const t = (v - a[0]) / (b[0] - a[0]);
  const pa = hex(a[1]), pb = hex(b[1]);
  return `rgb(${pa.map((x, i) => Math.round(x + (pb[i] - x) * t)).join(",")})`;
}
export function rampColor(stops: [number, string][], v: number | null): string {
  const s = stops;
  if (v == null) return "#9aa5ad";
  if (v <= s[0][0]) return s[0][1];
  if (v >= s[2][0]) return s[2][1];
  return v < s[1][0] ? mix(s[0], s[1], v) : mix(s[1], s[2], v);
}
export const priceColor = (v: number | null) => rampColor(PRICE_STOPS, v);
export const devColor = (v: number | null) => rampColor(DEV_STOPS, v);
// 發散色階兩端深色配白字、中段淺色配深字
export const devTextColor = (v: number | null) => (v != null && Math.abs(v) >= 7 ? "#fff" : "#43390f");
export const fmtDev = (v: number | null, digits = 1) =>
  v == null ? null : `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;

// API 回應的 city(全市各帶基準)→ 每個 feature 補 dev_<band>(%)
export function augmentDev(geo: any) {
  const city = geo.city ?? {};
  for (const f of geo.features) {
    for (const key of ["all", ...AGE_BANDS]) {
      const base = city[`price_${key}`], v = f.properties[`price_${key}`];
      f.properties[`dev_${key}`] =
        base > 0 && v != null ? +((v / base - 1) * 100).toFixed(1) : null;
    }
  }
  return geo;
}
