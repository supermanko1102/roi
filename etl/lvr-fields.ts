import fs from "node:fs";
import { parse } from "csv-parse/sync";

export const rocDate = (s?: string): string | null => {
  if (!s || s.length < 6) return null;
  const p = s.padStart(7, "0");
  const y = +p.slice(0, 3) + 1911, m = p.slice(3, 5), d = p.slice(5, 7);
  return m === "00" || d === "00" ? null : `${y}-${m}-${d}`;
};

export const num = (s?: string) => {
  const n = parseFloat((s ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

export const col = (headers: string[], ...keys: string[]) =>
  headers.findIndex((header) => keys.every((key) => header.includes(key)));

export const intOrNull = (s?: string) => {
  const n = parseInt((s ?? "").trim(), 10);
  return Number.isFinite(n) ? n : null;
};

/** 從「土地6建物1車位2」取出本筆交易的車位數；欄位缺漏時保留 null，不能當成 0。 */
export function parseParkingCount(s?: string): number | null {
  const match = (s ?? "").match(/車位\s*(\d+)/);
  return match ? Number(match[1]) : null;
}

const CN_DIGIT: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

export function parseFloor(s?: string): number | null {
  if (!s) return null;
  const first = s.split(/[,,、]/)[0].replace(/層.*$/, "").trim();
  if (!first || first.includes("地下") || first === "全") return null;
  if (/^\d+$/.test(first)) return +first;
  const m = first.match(/^([一二三四五六七八九]?)(十?)([一二三四五六七八九]?)$/);
  if (!m) return null;
  const tens = m[2] ? (m[1] ? CN_DIGIT[m[1]] : 1) : 0;
  const ones = m[2] ? (m[3] ? CN_DIGIT[m[3]] : 0) : (m[1] ? CN_DIGIT[m[1]] : NaN);
  const value = tens * 10 + ones;
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function readCsv(file: string): string[][] {
  let text = fs.readFileSync(file, "utf-8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = parse(text, {
    relax_column_count: true, quote: false, skip_empty_lines: true,
  });
  return rows.filter((_, index) => index !== 1);
}
