import { cityPrefixRe } from "../src/lib/cities";

const ROAD = "(?:[^,，、]{1,12}?(?:路|街|大道)(?:[一二三四五六七八九十]段)?)";

export const toHalf = (s: string) =>
  s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
   .replace(/－/g, "-");

const CN_DIGIT = "一二三四五六七八九";

/**
 * 中文數字(1~99)轉阿拉伯數字,用於比對前的正規化:
 * NLSC 回傳的街名是中文數字(新富十一街),實登地址是阿拉伯數字(新富11街)。
 * 兩側都過同一個轉換,誤轉(統一路→統1路)不影響相等性比較。
 */
export const normalizeCnNums = (s: string) =>
  s.replace(/[一二三四五六七八九十]+/g, (m) => {
    const match = m.match(new RegExp(`^([${CN_DIGIT}])?(十)?([${CN_DIGIT}])?$`));
    if (!match || (!match[1] && !match[2] && !match[3]) || (match[1] && !match[2] && match[3])) return m;
    const tens = match[2] ? (match[1] ? CN_DIGIT.indexOf(match[1]) + 1 : 1) : 0;
    const ones = match[2] ? (match[3] ? CN_DIGIT.indexOf(match[3]) + 1 : 0) : CN_DIGIT.indexOf(match[1]!) + 1;
    return String(tens * 10 + ones);
  });

export type ParsedSiteAddress =
  | { kind: "door"; road: string; q: string }
  | { kind: "cross"; road: string; road2: string; q: string; q2: string }
  | { kind: "road"; road: string; q: string };

export type AddressCandidate = { raw: string; source: "deal" | "community" };

/** 成交地址永遠優先；備查地址去空白、去重後才依序作 fallback。 */
export function siteAddressCandidates(address: string | null, communityStreets: string[]): AddressCandidate[] {
  const candidates: AddressCandidate[] = [];
  if (address?.trim()) candidates.push({ raw: address.trim(), source: "deal" });
  for (const street of communityStreets) {
    const raw = street.trim();
    if (raw && !candidates.some((candidate) => candidate.raw === raw))
      candidates.push({ raw, source: "community" });
  }
  return candidates;
}

/** 將預售工地描述拆成門牌、確切路口或僅路名；僅路名不得當成精確點位。 */
export function parseSiteAddress(city: string, district: string, raw: string): ParsedSiteAddress | null {
  let a = toHalf(raw.trim());
  // 市/區前綴可能重複出現(髒資料如「桃園市觀音區桃園市觀音區聖心二街…」),剝到穩定為止
  for (let prev = ""; prev !== a; ) {
    prev = a;
    a = a.replace(cityPrefixRe, "").replace(new RegExp(`^${district}`), "");
  }
  a = a
    .replace(/桃園區福林段.*$/, "") // 桃園區特有的髒資料尾綴
    .replace(/(之鄰地|附近等|附近|一帶|旁邊|旁|對面|斜對面|交界處|交界|上)$/, "");
  a = a.replace(/(\d+)[~〜-](\d+)號/, (_, x, y) => `${Math.round((+x + +y) / 2)}號`);

  const door = a.match(new RegExp(`^(${ROAD}(?:\\d+巷)?(?:\\d+弄)?)(\\d+)號`));
  if (door) return { kind: "door", road: door[1], q: `${city}${district}${door[1]}${door[2]}號` };

  const delimitedCross = a.match(new RegExp(`^(${ROAD})[與和、及/／，.·](${ROAD})`));
  const adjacentCross = a.match(new RegExp(`^(${ROAD})(${ROAD})(?:交叉)?路?口`));
  const cross = delimitedCross ?? adjacentCross;
  if (cross) return {
    kind: "cross", road: cross[1], road2: cross[2],
    q: `${city}${district}${cross[1]}`, q2: `${city}${district}${cross[2]}`,
  };

  const road = a.match(new RegExp(`^(${ROAD})`));
  if (road) return { kind: "road", road: road[1], q: `${city}${district}${road[1]}` };
  return null;
}
