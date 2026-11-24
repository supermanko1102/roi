import { cityByName } from "./cities";

export type Bbox = [number, number, number, number];

export function parseBbox(raw: string | null): { value: Bbox | null; error?: string } {
  if (!raw) return { value: null };
  const values = raw.split(",").map(Number);
  if (values.length !== 4 || !values.every(Number.isFinite))
    return { value: null, error: "bad bbox" };
  const [minLng, minLat, maxLng, maxLat] = values;
  if (minLng < -180 || maxLng > 180 || minLat < -90 || maxLat > 90 || minLng >= maxLng || minLat >= maxLat)
    return { value: null, error: "bad bbox range" };
  if (maxLng - minLng > 3 || maxLat - minLat > 3)
    return { value: null, error: "bbox too large" };
  return { value: values as Bbox };
}

export function parseCity(raw: string | null) {
  if (!raw) return { value: null };
  const city = cityByName(raw);
  return city ? { value: city.name } : { value: null, error: "bad city" };
}

export function validText(value: string | null, maxLength: number) {
  return value != null && value.trim().length > 0 && value.length <= maxLength;
}

// 資料每天最多更新一次:CDN 新鮮 10 分鐘,之後一天內先回舊的、背景重算,
// 使用者不會等到冷啟動的資料庫查詢。
export const MAP_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=600, stale-while-revalidate=86400",
};

export const DETAIL_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
};
