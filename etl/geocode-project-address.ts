const ROAD = "(?:[^,，、]{1,12}?(?:路|街|大道)(?:[一二三四五六七八九十]段)?)";

export const toHalf = (s: string) =>
  s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
   .replace(/－/g, "-");

export type ParsedSiteAddress =
  | { kind: "door"; road: string; q: string }
  | { kind: "cross"; road: string; road2: string; q: string; q2: string }
  | { kind: "road"; road: string; q: string };

/** 將預售工地描述拆成門牌、確切路口或僅路名；僅路名不得當成精確點位。 */
export function parseSiteAddress(district: string, raw: string): ParsedSiteAddress | null {
  let a = toHalf(raw.trim())
    .replace(/^桃園市/, "").replace(new RegExp(`^${district}`), "")
    .replace(/桃園區福林段.*$/, "")
    .replace(/(之鄰地|附近等|附近|一帶|旁邊|旁|對面|斜對面|交界處|交界|上)$/, "");
  a = a.replace(/(\d+)[~〜-](\d+)號/, (_, x, y) => `${Math.round((+x + +y) / 2)}號`);

  const door = a.match(new RegExp(`^(${ROAD}(?:\\d+巷)?(?:\\d+弄)?)(\\d+)號`));
  if (door) return { kind: "door", road: door[1], q: `桃園市${district}${door[1]}${door[2]}號` };

  const delimitedCross = a.match(new RegExp(`^(${ROAD})[與和、及/／，.·](${ROAD})`));
  const adjacentCross = a.match(new RegExp(`^(${ROAD})(${ROAD})(?:交叉)?路?口`));
  const cross = delimitedCross ?? adjacentCross;
  if (cross) return {
    kind: "cross", road: cross[1], road2: cross[2],
    q: `桃園市${district}${cross[1]}`, q2: `桃園市${district}${cross[2]}`,
  };

  const road = a.match(new RegExp(`^(${ROAD})`));
  if (road) return { kind: "road", road: road[1], q: `桃園市${district}${road[1]}` };
  return null;
}
