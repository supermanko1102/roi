// 建案獨立頁的網址:/project/城市/行政區/建案名。
// 用自然鍵而不是流水號——projects 會被 ETL 重建,名稱才是穩定的身分;
// 建案名可能含「/」(同案雙名),所以名稱段是 catch-all,逐段編碼。
const enc = encodeURIComponent;

export function projectPath(city: string, district: string, name: string): string {
  return `/project/${enc(city)}/${enc(district)}/${name.split("/").map(enc).join("/")}`;
}

/** 回地圖並打開同一個建案抽屜的網址 */
export function projectMapPath(city: string, district: string, name: string, lng?: number | null, lat?: number | null): string {
  const q = new URLSearchParams({ proj: `${city}|${district}|${name}` });
  if (lng != null && lat != null) { q.set("lng", lng.toFixed(5)); q.set("lat", lat.toFixed(5)); q.set("z", "16.40"); }
  return `/?${q.toString()}`;
}

/** 對外的絕對網址基底(canonical / sitemap 用) */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return vercel ? `https://${vercel}` : "https://roi-nu.vercel.app";
}
