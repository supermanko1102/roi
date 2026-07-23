/**
 * 修復政府 CSV 輸出造成的建案名稱亂碼(Big5 字集外字元被替換成「?」)。
 * 同一建案會因不同季別編碼品質不一而分裂成「新濠一?」與「新濠一閱」兩筆,稀釋統計。
 * 策略:
 *  1. NAME_OVERRIDES 人工對照表優先——處理歧義命中與所有季別皆亂碼的案例。
 *  2. 自動歸併:同市+區內把「?」當單字元萬用比對乾淨名稱,唯一命中
 *     且兩側工地路名不衝突才改名;多重命中或路名衝突只列報告,不動資料。
 * 只改 presale_deals 與 contract_materials 的 project_name;
 * projects 的歸併交給下一步 compute-stats 重建(upsert 會保留既有座標)。
 * 用法:tsx etl/fix-mangled-names.ts          # dry-run,只印報告
 *      tsx etl/fix-mangled-names.ts --apply  # 實際改名
 */
import { createDb } from "../db/client";
import { parseSiteAddress } from "./geocode-project-address";

/** city|district|亂碼名 → 正確名。查證來源:樂居、備查契約 PDF。 */
const NAME_OVERRIDES: Record<string, string> = {
  "桃園市|桃園區|?讀伊頓": "悦讀伊頓",
};

type Group = { city: string; district: string; name: string; n: number; addr: string | null };

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function road(city: string, district: string, addr: string | null): string | null {
  if (!addr?.trim()) return null;
  return parseSiteAddress(city, district, addr.trim())?.road ?? null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const { pool } = createDb();

  const { rows: mangled } = await pool.query<Group>(`
    SELECT city, district, project_name AS name, count(*)::int AS n,
           mode() WITHIN GROUP (ORDER BY address) AS addr
    FROM presale_deals
    WHERE project_name LIKE '%?%'
    GROUP BY 1, 2, 3
    ORDER BY n DESC
  `);
  console.log(`[fix-names] 亂碼建案 ${mangled.length} 個${apply ? "" : "(dry-run,--apply 才會改名)"}`);

  const merges: Array<{ g: Group; to: string; via: string }> = [];
  const ambiguous: string[] = [];
  const unresolved: string[] = [];

  for (const g of mangled) {
    const label = `${g.city}${g.district}「${g.name}」(${g.n}筆)`;
    const override = NAME_OVERRIDES[`${g.city}|${g.district}|${g.name}`];
    if (override) { merges.push({ g, to: override, via: "override" }); continue; }

    const pattern = likeEscape(g.name).replace(/\?/g, "_");
    const { rows: candidates } = await pool.query<Group>(`
      SELECT city, district, project_name AS name, count(*)::int AS n,
             mode() WITHIN GROUP (ORDER BY address) AS addr
      FROM presale_deals
      WHERE city = $1 AND district = $2
        AND project_name NOT LIKE '%?%'
        AND project_name LIKE $3 ESCAPE '\\'
      GROUP BY 1, 2, 3
    `, [g.city, g.district, pattern]);

    if (candidates.length === 0) { unresolved.push(label); continue; }
    if (candidates.length > 1) {
      ambiguous.push(`${label} → ${candidates.map((c) => `${c.name}(${c.n})`).join(" / ")}`);
      continue;
    }
    const c = candidates[0];
    const r1 = road(g.city, g.district, g.addr);
    const r2 = road(c.city, c.district, c.addr);
    if (r1 && r2 && r1 !== r2) {
      ambiguous.push(`${label} → ${c.name}(${c.n}) 但路名衝突:${r1} vs ${r2}`);
      continue;
    }
    merges.push({ g, to: c.name, via: "auto" });
  }

  for (const { g, to, via } of merges)
    console.log(`  merge[${via}] ${g.city}${g.district}「${g.name}」(${g.n}筆) → 「${to}」`);
  if (ambiguous.length) {
    console.log(`\n  歧義 ${ambiguous.length} 個(需加入 NAME_OVERRIDES 才會處理):`);
    for (const line of ambiguous) console.log(`    ${line}`);
  }
  if (unresolved.length) {
    console.log(`\n  無乾淨對應 ${unresolved.length} 個(名稱維持亂碼,不影響統計):`);
    for (const line of unresolved) console.log(`    ${line}`);
  }

  if (apply && merges.length) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const { g, to } of merges) {
        await client.query(
          `UPDATE presale_deals SET project_name = $1
           WHERE city = $2 AND district = $3 AND project_name = $4`,
          [to, g.city, g.district, g.name]);
        // 乾淨名稱那側已有契約列時,亂碼列直接刪除,避免撞 unique key
        await client.query(
          `DELETE FROM contract_materials m
           WHERE m.city = $2 AND m.district = $3 AND m.project_name = $4
             AND EXISTS (SELECT 1 FROM contract_materials k
                         WHERE k.city = $2 AND k.district = $3 AND k.project_name = $1)`,
          [to, g.city, g.district, g.name]);
        await client.query(
          `UPDATE contract_materials SET project_name = $1
           WHERE city = $2 AND district = $3 AND project_name = $4`,
          [to, g.city, g.district, g.name]);
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    console.log(`\n[fix-names] 已改名 ${merges.length} 個建案;請接著跑 etl:stats 重建 projects 歸併`);
  } else {
    console.log(`\n[fix-names] 可歸併 ${merges.length}、歧義 ${ambiguous.length}、無對應 ${unresolved.length}`);
  }
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
