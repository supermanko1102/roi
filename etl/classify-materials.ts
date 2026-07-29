/**
 * 建材分類:contract_materials(status=ok)→ contract_material_facts(全量重建)
 *
 * 規則式抽取,不需 LLM:
 *   1. 逐行掃 materials_text,行內建材詞(馬桶/瓦斯爐…)優先決定該行情境(衛浴/廚具),
 *      無行內詞時沿用最近的段落標題情境(■衛浴設備/※廚房…)。
 *   2. 品牌比對 etl/material-brand-tiers.json 的 aliases;不在字典的品牌樣式記
 *      unknown_brands 供人工審核補字典。
 *   3. 等級=該分類命中品牌(排除 accessory 配件)的最低 tier——「A或B或C」條款建商可
 *      任選,契約保證下限即最低階。
 *   4. 居室地坪:只認含客/餐廳/臥室/居室等區域詞的行,比對 floor_materials aliases。
 *
 * 用法:tsx etl/classify-materials.ts [--verbose]
 */
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { createDb, contract_material_facts } from "../db/client";

const VERBOSE = process.argv.includes("--verbose");

type Brand = { name: string; tier: number; category: "bath" | "kitchen" | "both"; accessory?: boolean; sub?: string; aliases: string[] };
type FloorMat = { name: string; tier: number; aliases: string[] };
const DICT = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "material-brand-tiers.json"), "utf-8"),
) as { brands: Brand[]; floor_materials: FloorMat[] };

// 行內情境詞:出現即決定該行歸屬,優先於段落情境
const BATH_LINE = /馬桶|面盆|臉盆|洗臉盆|浴缸|蓮蓬|淋浴|免治|衛浴|浴室|浴廁|暖風機/;
const KITCHEN_LINE = /廚具|廚房|瓦斯爐|排油煙|抽油煙|烘碗|洗碗|蒸爐|烤箱|感應爐|IH爐|淨水|濾水|水槽|調理/;
// 段落標題:行首標記(■/※/⚫/（六）/一、…)+ 分類詞;粗鬆比對即可,行內詞會蓋過誤差
const HEAD_BATH = /^[\s■※⚫●◎(（【\d一二三四五六七八九十、.)）】]*.{0,4}(衛浴|浴廁)/;
const HEAD_KITCHEN = /^[\s■※⚫●◎(（【\d一二三四五六七八九十、.)）】]*.{0,4}(廚房|廚具)/;
const HEAD_FLOOR = /^[\s■※⚫●◎(（【\d一二三四五六七八九十、.)）】]*.{0,4}(地坪|室內裝修|地板)/;
const HEAD_OTHER = /^[\s■※⚫●◎(（【\d一二三四五六七八九十、.)）】]*.{0,4}(門窗|陽台|結構|外觀|平頂|牆面|電梯|樓梯|門廳|梯廳|給排水|消防|安全|停車|屋頂|電器)/;
// 居室地坪:行內有區域詞,或在地坪段落內且非其他空間,避免把浴室/陽台/梯廳地磚當居室主材
const LIVING_AREA = /客.?餐廳|客廳|餐廳|臥室|房間|居室|各戶室內/;
const NONLIVING = /浴|陽台|露台|梯廳|門廳|樓梯|車道|地下|屋頂|公共|電梯|玄關|走道磚/;
const WALL_LINE = /牆面|壁磚|踢腳|平頂|天花/;
// 店鋪/公設空間的配備不代表住家等級
const NONRES_LINE = /店[鋪舖]|零售|公廁|無障礙廁所|管理室/;

// 保固/違約條款的品牌列舉行(「固定建材及設備部分(如:門窗、粉刷、地磚…)」)不可計入
const WARRANTY_LINE = /保固|違反|瑕疵|沒收|解除|賠償/;

const floorAliasIn = (l: string) =>
  DICT.floor_materials.some((f) => f.aliases.some((a) => l.includes(a)));

/** 逐材質比對一行,邊中邊消費字串避免重疊(拋光石英磚 中了就不再中 石英磚) */
function matchFloors(line: string, into: Set<string>) {
  let rest = line;
  for (const f of DICT.floor_materials) {
    for (const a of f.aliases) {
      if (rest.includes(a)) { into.add(f.name); rest = rest.split(a).join(""); }
    }
  }
}

export function classify(text: string, debug = false) {
  const kitchen = new Set<string>(), bath = new Set<string>(), unknown = new Set<string>();
  const floorsExplicit = new Set<string>(), floorsCtx = new Set<string>();
  let ctx: "bath" | "kitchen" | "other" = "other";
  let floorCtx = false;
  let nonresItem = false; // 店鋪/公設段落(可能跨行)內
  const ITEM_START = /^[(（]?[一二三四五六七八九十\d]+[、.):）]/;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) { nonresItem = false; continue; } // 店鋪範圍不跨段落(空行=段落界)
    if (WARRANTY_LINE.test(line)) continue;
    if (NONRES_LINE.test(line)) { nonresItem = true; continue; }
    // pdftotext layout 會在標題字間塞空白(※廚 房/※電 梯 間),標題比對用去空白版;
    // 加長度上限區分標題與折行內文(「牌衛浴設備,搭配TOTO…」開頭像標題但很長)
    const hh = line.replace(/\s+/g, "");
    const h = hh.length <= 16 ? hh : "";
    const isHead = HEAD_BATH.test(h) || HEAD_KITCHEN.test(h) ||
      (HEAD_FLOOR.test(h) && !floorAliasIn(h)) || HEAD_OTHER.test(h);
    if (isHead || ITEM_START.test(line)) nonresItem = false; // 新條目/新段落結束店鋪範圍
    if (nonresItem) { if (debug) console.log("[skip:店鋪]", line.slice(0, 50)); continue; }
    if (HEAD_BATH.test(h)) { ctx = "bath"; floorCtx = false; }
    else if (HEAD_KITCHEN.test(h)) { ctx = "kitchen"; floorCtx = false; }
    // 標題行才切地坪情境(含材質字樣的是內文);「陽台地坪」等非居室標題不算
    else if (HEAD_FLOOR.test(h) && !floorAliasIn(h)) { ctx = "other"; floorCtx = !NONLIVING.test(h); }
    else if (HEAD_OTHER.test(h)) { ctx = "other"; floorCtx = false; }
    const lineCtx = BATH_LINE.test(line) && !KITCHEN_LINE.test(line) ? "bath"
      : KITCHEN_LINE.test(line) && !BATH_LINE.test(line) ? "kitchen"
      : BATH_LINE.test(line) && KITCHEN_LINE.test(line) ? "mixed" : ctx;

    for (const b of DICT.brands) {
      if (!b.aliases.some((a) => line.toLowerCase().includes(a.toLowerCase()))) continue;
      // 專屬分類品牌一律落自己的袋;both 品牌(HANSGROHE/KOHLER…)靠情境分袋,情境不明就略過
      const bucket = b.category !== "both" ? b.category
        : lineCtx === "bath" || lineCtx === "kitchen" ? lineCtx : null;
      if (bucket === "bath") bath.add(b.name);
      else if (bucket === "kitchen") kitchen.add(b.name);
    }
    // 未知品牌樣式:連續 3+ 大寫字母的英文詞,且不屬於任何 alias
    for (const m of line.matchAll(/[A-Z][A-Za-z&]{2,}/g)) {
      const w = m[0];
      if (/^(CNS|PVC|EPOXY|EXPOXY|LED|LOW|SPC|ICI|ATS|CCTV|LOBBY|MIFARE|RC|SGS|DNA|III|II)$/i.test(w)) continue;
      if (!DICT.brands.some((b) => b.aliases.some((a) => a.toLowerCase().includes(w.toLowerCase()) || w.toLowerCase().includes(a.toLowerCase()))))
        unknown.add(w);
    }
    // 居室地坪:行內有區域詞(explicit)優於僅靠地坪段落情境(ctx);牆面/平頂行不算
    if (!WALL_LINE.test(line)) {
      if (LIVING_AREA.test(line) && !NONLIVING.test(line)) {
        if (debug && floorAliasIn(line)) console.log("[floor:explicit]", line.slice(0, 60));
        matchFloors(line, floorsExplicit);
      } else if (floorCtx && !NONLIVING.test(line)) {
        if (debug && floorAliasIn(line)) console.log("[floor:ctx]", line.slice(0, 60));
        matchFloors(line, floorsCtx);
      }
    }
  }
  // 有明確居室行就只信它;沒有才用段落情境(南海敘式無標題文本的容錯)
  const floors = floorsExplicit.size ? floorsExplicit : floorsCtx;
  const tierOf = (names: Set<string>, cat: "bath" | "kitchen") => {
    const hits = [...names]
      .map((n) => DICT.brands.find((b) => b.name === n)!)
      .filter((b) => !b.accessory && (b.category === cat || b.category === "both"));
    // 廚具等級以櫃體/系統品牌優先(三機配件是基本盤,不應把 LEICHT 級廚房拉成國產階)
    const pool = cat === "kitchen" && hits.some((b) => b.sub === "cabinet")
      ? hits.filter((b) => b.sub === "cabinet") : hits;
    return pool.length ? Math.min(...pool.map((b) => b.tier)) : null;
  };
  const floorTiers = [...floors].map((n) => DICT.floor_materials.find((f) => f.name === n)!.tier);
  // 顯示排序:主件品牌依等級高→低,配件(暖風機/濾水器)墊底
  const ordered = (names: Set<string>) => [...names].sort((x, y) => {
    const a = DICT.brands.find((b) => b.name === x)!, b2 = DICT.brands.find((b) => b.name === y)!;
    return (a.accessory ? 1 : 0) - (b2.accessory ? 1 : 0) || b2.tier - a.tier;
  });
  return {
    kitchen: ordered(kitchen), bath: ordered(bath), floors: [...floors], unknown: [...unknown],
    kitchenTier: tierOf(kitchen, "kitchen"),
    bathTier: tierOf(bath, "bath"),
    floorTier: floorTiers.length ? Math.min(...floorTiers) : null,
  };
}

async function main() {
  const { db, pool } = createDb();
  try {
    const rows = (await db.execute(sql`
      SELECT city, district, project_name, materials_text
      FROM contract_materials WHERE status = 'ok' ORDER BY city, district, project_name
    `)).rows as unknown as { city: string; district: string; project_name: string; materials_text: string }[];

    let withAny = 0;
    const unknownCount = new Map<string, number>();
    for (const r of rows) {
      const c = classify(r.materials_text);
      if (c.kitchen.length || c.bath.length || c.floors.length) withAny++;
      for (const u of c.unknown) unknownCount.set(u, (unknownCount.get(u) ?? 0) + 1);
      if (VERBOSE)
        console.log(`${r.city}${r.district}「${r.project_name}」廚[${c.kitchen}](${c.kitchenTier}) 衛[${c.bath}](${c.bathTier}) 地[${c.floors}](${c.floorTier})`);
      await db.insert(contract_material_facts)
        .values({
          city: r.city, district: r.district, project_name: r.project_name,
          kitchen_brands: JSON.stringify(c.kitchen), bath_brands: JSON.stringify(c.bath),
          floor_materials: JSON.stringify(c.floors), unknown_brands: JSON.stringify(c.unknown),
          kitchen_tier: c.kitchenTier, bath_tier: c.bathTier, floor_tier: c.floorTier,
        })
        .onConflictDoUpdate({
          target: [contract_material_facts.city, contract_material_facts.district, contract_material_facts.project_name],
          set: {
            kitchen_brands: JSON.stringify(c.kitchen), bath_brands: JSON.stringify(c.bath),
            floor_materials: JSON.stringify(c.floors), unknown_brands: JSON.stringify(c.unknown),
            kitchen_tier: c.kitchenTier, bath_tier: c.bathTier, floor_tier: c.floorTier,
            extracted_at: new Date(),
          },
        });
    }
    const topUnknown = [...unknownCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
    console.log(`[classify] ${rows.length} 案完成,${withAny} 案抽到至少一類`);
    console.log(`[classify] 高頻未知品牌樣式(補字典候選):`, topUnknown.map(([w, n]) => `${w}×${n}`).join(" "));
  } finally {
    await pool.end();
  }
}

// 直接執行才跑 main;被 debug 腳本 import 時只取用 classify
if (process.argv[1]?.endsWith("classify-materials.ts"))
  main().catch((e) => { console.error(e); process.exit(1); });
