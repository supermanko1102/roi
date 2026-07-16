// 屋齡帶:整個前端/API 的統一軸。預售只是「屋齡 < 0」的特例,
// 完工後自動落入 0-5 → 5-10 → …,不再有預售/中古雙軌。
// key 用底線版(0_5)以便直接當 GeoJSON property 後綴(price_0_5)。

export const AGE_BANDS = ["presale", "0_5", "5_10", "10_20", "20p"] as const;
export type AgeBand = (typeof AGE_BANDS)[number] | "unknown";
export type BandFilter = "all" | (typeof AGE_BANDS)[number];

export const BAND_LABEL: Record<BandFilter, string> = {
  all: "全部", presale: "預售", "0_5": "0-5年", "5_10": "5-10年", "10_20": "10-20年", "20p": "20年+",
};

// build_year=完工西元年;null=登錄缺漏 → 不明(只在「全部」時顯示)
export function ageBand(buildYear: number | null | undefined, nowYear = new Date().getFullYear()): AgeBand {
  if (buildYear == null) return "unknown";
  const age = nowYear - buildYear;
  if (age < 0) return "presale";
  if (age < 5) return "0_5";
  if (age < 10) return "5_10";
  if (age < 20) return "10_20";
  return "20p";
}
