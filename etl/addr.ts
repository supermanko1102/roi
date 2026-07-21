import { cityByName, cityPrefixRe, type City } from "../src/lib/cities";

const toHalfAlnum = (s: string) =>
  s.replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

/**
 * 建照/使照號碼正規化:半形、去空白、年度與序號去前導零
 * (「088建字第0221號」→「88建字第221號」)。備查與使照兩邊同法處理後才能 join。
 */
export function normPermitNo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = toHalfAlnum(raw).replace(/\s/g, "");
  if (!s) return null;
  const m = s.match(/^(\d+)(.*?字第)(\d+)(號?.*)$/);
  return m ? `${+m[1]}${m[2]}${+m[3]}${m[4] || "號"}` : s;
}

/**
 * 歸戶鍵:地址截到「號」,並保證帶「{城市}{區}」前綴(城市寫法正規化成 cities 的 name)。
 * 全城市統一前綴後,addr_key 天然全域唯一(geocode_cache 以它當 PK)。
 * parse-lvr 與 match-communities 兩邊都用這支,確保鍵一致。
 */
export function normAddrKey(city: City, district: string, addr: string): string | null {
  if (!addr.includes("號")) return null;
  let key = addr.replace(/號.*$/, "號");
  const m = key.match(cityPrefixRe);
  if (m) {
    const c = cityByName(m[1]);
    if (c) key = c.name + key.slice(m[1].length); // 臺/台 正規化
    return key;
  }
  return key.startsWith(district) ? `${city.name}${key}` : `${city.name}${district}${key}`;
}
