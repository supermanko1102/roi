// 產品定義的新古屋租金池：目前屋齡 1–10 年。
// 0 年新成屋與屋齡不明案件不混入，避免不同 API/ETL 各自漂移。
export const MIN_RENT_BUILDING_AGE = 1;
export const MAX_RENT_BUILDING_AGE = 10;
export const RENT_LOOKBACK_YEARS = 3;
export const RENT_PRIMARY_RADIUS_M = 1000;
export const RENT_FALLBACK_RADIUS_M = 2500;
export const RENT_MIN_COMPS = 5;

